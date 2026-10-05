import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  type ContinuationIntent,
  type ContinuationOutcome,
  createComposeSdk,
  raw,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { API_KEY, BASE_URL } from '../config.js';

// USDC on Ethereum mainnet (6 decimals). Matches the funding input, the
// committed outcome token, and the second-leg balance read below.
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

// The self-serve settlement provider's registry name. This literal must match
// `MANUAL_RELAY_PROVIDER_NAME` in the compose-builtins package
// (ts/packages/compose-builtins/src/providers/manualRelay/provider.ts); that
// package is not an SDK dependency, so it is inlined here rather than imported.
const MANUAL_RELAY_PROVIDER = 'manual-relay';

export interface ManualRelayContinuationInput {
  /** The transaction signer for leg 1. */
  readonly owner: Address;
  /** Where the committed outcome is delivered — the user's own custody. */
  readonly recipient: Address;
  /** Funding amount for leg 1, in USDC smallest units (6 decimals). */
  readonly amount: `${bigint}`;
  /** Minimum USDC (smallest units) the outcome commits to delivering. */
  readonly minAmountOut: `${bigint}`;
  /** Unix-epoch milliseconds after which the continuation is no longer valid. */
  readonly expiresAtMs: number;
}

/**
 * Manual-relay (self-serve) deferred settlement — the two-leg continuation model.
 *
 * A `continuation.settle` node splits one intent into two legs. Leg 1 funds the
 * settlement and commits to an outcome; leg 2 is a second flow the caller
 * re-submits later, once the committed proceeds have actually landed. The
 * `manual-relay` provider performs no I/O and funds no escrow — the funds stay
 * in the user's own custody between the legs, and the caller ("relays") the
 * second leg itself. That makes it the simplest provider to author against and
 * the right one for a self-serve integration.
 *
 * Why `untypedOp`:
 * - `continuation.settle` has no generated `builder.*` method: it is a
 *   provider-dependent factory op (`createContinuationSettleOp`), registered at
 *   server wiring rather than emitted into the static manifest the SDK is
 *   generated from, so it never appears on the typed builder surface. It is
 *   authored through the `untypedOp` escape hatch: the op id is a plain string
 *   and its `bind`/`config` are validated by the backend at compile time rather
 *   than by the TypeScript surface.
 * - The funding resource is wired via `bind.input` (a resource ref). The delivery
 *   address is not bound: it is `config.outcomes[0].destination`, which becomes
 *   the produced future resource's owner.
 * - `config` is a `ContinuationIntent`. This example imports `ContinuationIntent`
 *   and `ContinuationOutcome` from the SDK's own re-exports (`../../index.js`) to
 *   type the config even though the op itself is untyped — the authoring types
 *   ship publicly even while the op is staged.
 *
 * The committed terms:
 * - `outcomes` — one or more `{ token, minAmount, destination, chainId }` promises.
 *   The manual-relay provider supports exactly one outcome per settle node; model
 *   multiple deliveries as multiple `continuation.settle` nodes.
 * - `validity.expiresAtMs` — after this the continuation cannot be settled.
 * - `provider` — the settlement mechanism, selected by name (`manual-relay` here).
 * - `continuationFlow` — the inline second leg. The provider embeds the readiness
 *   `check` into it as a pre-execution on-chain assertion before returning it, so a
 *   premature re-submission reverts instead of running on stale balances.
 *
 * How to CONSUME the compile response (leg 1):
 * - `settlements.<node>` — what the response says about this settle node. For
 *   manual-relay there is no `escrow` and no settlement action in `actions`:
 *   nothing to sign or fund now, the funds stay in the user's custody. (Other
 *   providers may disclose an `escrow` with a `fundEscrow` action, or add a
 *   `signOrder` action.)
 * - `settlements.<node>.continuation` — `{ chainId, validity, check, nextFlow }`.
 *   Poll the `check` (an `erc20BalanceGte` predicate here) until it passes, then
 *   re-submit `nextFlow` verbatim through the normal `/compose` pipeline.
 *   `nextFlow` already has the readiness check compiled in as an on-chain
 *   assertion, so an early re-submission reverts safely rather than executing on
 *   stale state.
 */
export const buildManualRelayContinuation = ({
  owner,
  recipient,
  amount,
  minAmountOut,
  expiresAtMs,
}: ManualRelayContinuationInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // The inline second leg. Authored as an ordinary flow via the builder; the
  // provider will prepend the readiness assertion to it before returning it in
  // `settlements.<node>.continuation`. Here it simply reads the delivered
  // proceeds — a real integration would deposit them into a vault, repay a
  // loan, etc.
  const secondLeg = sdk.flow(1, {
    name: 'manual-relay-continuation-leg2',
    inputs: {},
  });
  secondLeg.core.balanceOf('read-proceeds', {
    bind: {},
    config: { token: USDC, owner: recipient },
  });
  const continuationFlow: Flow = secondLeg.build();

  // The committed outcome: at least `minAmountOut` USDC delivered to `recipient`
  // on mainnet. `ContinuationOutcome` is the SDK-re-exported authoring type.
  const outcome: ContinuationOutcome = {
    token: USDC,
    minAmount: minAmountOut,
    destination: recipient,
    chainId: 1,
  };

  const config: ContinuationIntent = {
    outcomes: [outcome],
    validity: { expiresAtMs },
    provider: MANUAL_RELAY_PROVIDER,
    continuationFlow,
  };

  const builder = sdk.flow(1, {
    name: 'manual-relay-continuation-leg1',
    inputs: {
      usdc: resources.erc20(USDC, 1),
    },
  });

  // `continuation.settle` has no generated method (it is staged), so it is added
  // via untypedOp. `bind.input` carries the funding resource — a plain `$ref`
  // pointer into the flow's declared inputs, which `raw.ref` builds because
  // untypedOp takes wire-format refs. The delivery address is never bound; it
  // lives in `config.outcomes[0].destination` and becomes the owner of the
  // future resource this node produces.
  builder.untypedOp('settle', 'continuation.settle', {
    bind: {
      input: raw.ref<'resource'>('input.usdc'),
    },
    config,
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      usdc: amount,
    },
    // A deferred settle's output is a future resource with no spot value at
    // simulation time, so the price-impact guard would register it as 100%
    // impact. 0 disables the guard for this deferred-settlement flow.
    maxPriceImpactBps: 0,
  });

  return { flow, request };
};
