import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

const BASE = 8453;
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Circle EURC on Base (6 decimals).
const EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';
const VALIDITY_WINDOW_MS = 3_600_000;

export interface ContinuationBuyWithChangeInput {
  readonly owner: Address;
  // Receives the EURC.
  readonly payee: Address;
  // WETH to swap into the USDC that funds the escrow, in wei.
  readonly wethAmount: `${bigint}`;
  // EURC the payee receives, in base units (6 decimals).
  readonly eurcAmount: `${bigint}`;
  // The least USDC change the owner accepts, in base units (6 decimals).
  readonly minChangeAmount: `${bigint}`;
}

/**
 * Swap WETH to USDC on Base, then escrow the USDC for a deferred settlement
 * whose leg buys an exact EURC amount for the payee and returns the USDC it
 * did not spend to the owner.
 *
 * Demonstrates:
 * - One `continuation.settle` node with two outcomes and two destinations:
 *   `settle.outcomes[0]` (EURC) names the payee as its owner,
 *   `settle.outcomes[1]` (USDC) names the owner
 * - An exact purchase inside a leg: `paraswap.buy` delivers exactly
 *   `exactAmountOut`, so the EURC floor is the purchase itself and
 *   `minAmount` is omitted
 * - An outcome in the funding token (USDC): the buy leaves its unspent source
 *   in the leg's proxy as `unspentIn`, and the settle commits that USDC as
 *   the change. The unspent amount is a measured remainder with no enforced
 *   minimum, so this outcome sets `minAmount`: a fill that would return less
 *   change reverts
 * - Two amounts per outcome in the response: `amount.minimum` is the
 *   committed floor, `amount.estimate` the expected delivery. A funding above
 *   its floor buys the same EURC, so the whole increase is extra change
 *
 * The settlement contract checks both floors, so the payee is never paid
 * without the owner receiving the change. See `continuationSettle.ts` for the
 * leg contract and `continuationTwoOutcomes.ts` for two outcomes produced by
 * a split.
 */
export const buildContinuationBuyWithChangeExample = ({
  owner,
  payee,
  wethAmount,
  eurcAmount,
  minChangeAmount,
}: ContinuationBuyWithChangeInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // The leg: runs from the escrow on Base once the USDC has landed there.
  // The buy pulls only the USDC it needs; the EURC and the unspent USDC both
  // stay in the leg's proxy, where the settlement epilogue picks them up.
  const leg = sdk.flow(BASE, {
    name: 'buy-with-change-leg',
    inputs: { funding: resources.erc20(USDC, BASE) },
  });
  leg.paraswap.buy('buy', {
    bind: { amountIn: leg.inputs.funding },
    config: {
      resourceOut: resources.erc20(EURC, BASE),
      exactAmountOut: eurcAmount,
      srcDecimals: 6,
      destDecimals: 6,
      maxSlippageBps: 100,
    },
  });

  // The main flow: swap WETH to USDC, then escrow the USDC for the leg.
  const builder = sdk.flow(BASE, {
    name: 'swap-and-buy-with-change',
    inputs: { amountIn: resources.erc20(WETH, BASE) },
  });
  const swap = builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: { resourceOut: resources.erc20(USDC, BASE) },
  });
  builder.continuation.settle('settle', {
    bind: { input: swap.amountOut },
    config: {
      outcomes: [
        { token: EURC, destination: payee, chainId: BASE },
        {
          token: USDC,
          destination: owner,
          chainId: BASE,
          minAmount: minChangeAmount,
        },
      ],
      validity: { expiresAtMs: Date.now() + VALIDITY_WINDOW_MS },
      provider: 'intent-factory',
      refund: owner,
      continuationFlow: leg.build(),
    },
  });

  const flow = builder.build();

  // No `sweepTo`: the swap output funds the escrow and both outcomes are
  // delivered by the settlement, never landing in the VM.
  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: wethAmount }),
    },
  });

  return { flow, request };
};
