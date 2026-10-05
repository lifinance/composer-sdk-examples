import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL, OWNER } from './config.js';

// Base mainnet. Pendle PT-USDC, its underlying USDC, and WETH.
const BASE = 8453;
const PT_USDC = '0x0d18b7bab00988a442e31065e76286844809dc9a';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';

/**
 * Exit a Pendle PT position and swap **all** of the proceeds to WETH on Base.
 *
 * ## The problem this solves
 *
 * Every other swap op bakes a fixed input amount into the router calldata at
 * quote time. That is fine when you know the amount up front, and useless when
 * you do not: a PT exit routes through an on-chain AMM quote, so it can deliver
 * a little more or a little less than the estimate. With `lifi.swap` you must
 * name an amount, and whatever the exit over-delivers is stranded in the proxy
 * (or, if it under-delivers, the flow reverts).
 *
 * `fly.swap` is the only swap that can sit downstream of a producer whose output
 * is not known until execution. Fly's `DexAggregator` supports a variable-input
 * mode — the `amountIn` word is excluded from the signed quote, so leaving it
 * unset makes the contract resolve the amount on-chain: for an erc20 input,
 * `min(our balance, the allowance we granted)`; for a native input, whatever
 * `msg.value` the op forwards. The op therefore swaps *all* of whatever
 * actually arrives. Either leg may be the chain's gas coin.
 *
 * ## The two numbers, which are independent
 *
 * This is the thing to get right, because they sound alike and are not:
 *
 * - **`inputVarianceBps`** describes the **upstream**: how far its real output
 *   may sit either side of the estimate, symmetrically. It is a quantity, not a
 *   price.
 * - **`maxSlippageBps`** is ordinary **price** protection: expected rate versus
 *   achieved rate, sized on the pair, and completely unaffected by how much
 *   input turns up. It is enforced on-chain as a *rate* against the input
 *   actually consumed, so the percentage protection is identical at any size.
 *
 * Neither is derived from the other and neither constrains the other. A
 * `maxSlippageBps` below `inputVarianceBps` is perfectly legitimate.
 *
 * ## Choosing `inputVarianceBps` (default 50 = 0.5%)
 *
 * The compile-time input amount is **simulated** at the current block, not
 * guessed — the compiler runs the upstream and reads what it produced. So this
 * field covers only simulate-to-execute drift: block delay, yield accrued in
 * that window, and third parties moving the upstream's rate in between. Tens of
 * basis points, not percent.
 *
 * Widening it is safe but not free. The bottom of the band is what the compose
 * response publishes as the output's `amount.minimum`, so a wider band
 * minimum to whoever consumes your quote.
 *
 * ## Ignore the 50% slippage in the Fly calldata
 *
 * If you inspect the compiled transaction you will see a 50% slippage figure
 * where you configured 1%. That is deliberate and it is not your setting. All
 * Fly's own `slippage` parameter does is price its minimum-out floor, which is an
 * absolute amount fixed at quote time and therefore cannot scale down when a
 * legitimately smaller input arrives. The op sends a high value so that floor
 * can never be the binding constraint, and enforces its own rate-based bound
 * instead — which is strictly tighter for every in-band delivery. The number
 * that protects you is `maxSlippageBps`.
 *
 * ## What happens outside the band
 *
 * With `E` the simulated exit output, `v = inputVarianceBps`:
 *
 *     E = 1000, v = 200 (2%), p = 100 (1%)  ->  band [980, 1020]
 *
 *     delivered 1020  -> consumes 1020, nothing left over   (band top)
 *     delivered 1000  -> consumes 1000, nothing left over
 *     delivered  980  -> consumes  980, nothing left over   (band bottom)
 *     delivered  950  -> reverts on the op's own floor invariant
 *     delivered 1200  -> consumes 1020; the 180 excess is swept back to you
 *
 * Both out-of-band outcomes are safe. The upward cap exists because Fly
 * confiscates output above the quoted expectation rather than rejecting it, so
 * the op never approves more than it quoted for. Note the excess only comes back
 * if the run supplies `sweepTo` — without it the residue sits in the proxy until
 * a later flow or an explicit `POST /compose/sweep` collects it.
 *
 * ## Two limitations worth knowing before you author
 *
 * 1. **`fly.swap` cannot sit downstream of another *prepared* op.** `lifi.zap`
 *    (used here) and other plain ops are fine. `lifi.swap` and `paraswap.buy`
 *    are prepared, and the compiler rejects those chains with a message about
 *    splitting the flow across a continuation.
 * 2. **The upstream must deliver to the proxy.** `lifi.zap` does so by
 *    construction. An upstream that exposes its own delivery address — such as
 *    `morphoBlue.withdraw`'s `receiver` — must have it bound to
 *    `context.executionAddress`, or the amount it reports will diverge from what
 *    the proxy actually holds and the op's custody assertion reverts.
 *
 * Demonstrates:
 * - A variable-input swap consuming an upstream's entire, runtime-determined output
 * - `lifi.zap` as the nondeterministic producer (a PT exit through an AMM quote)
 * - `sweepTo`, which is what returns any out-of-band residue to the sender
 *
 * `fly.swap` is always registered on the backend; without `FLY_API_KEY` it uses
 * Fly's public host.
 *
 * See `docs/references/fly-api.md` for the router behaviour all of this rests on.
 */
export const buildFlySwapExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(BASE, {
    name: 'pt-usdc-exit-swap-all-to-weth',
    inputs: {
      amountIn: resources.erc20(PT_USDC, BASE),
    },
  });

  // Exit the PT position to its underlying USDC. `lifi.zap` declares no
  // output-amount estimator, so the compiler cannot resolve the next node's
  // input statically and instead simulates this node to read what it really
  // produced. That simulated value is what `fly.swap` quotes against, and it is
  // why a 50 bps band is enough.
  const exitPt = builder.lifi.zap('exitPt', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(USDC, BASE),
    },
  });

  // Swap the entire exit output to WETH.
  //
  // No slippage guard here, and none is accepted: `amountOut` declares
  // `providesMinimum`, so the op owns its own bound. Attaching one is a
  // `guard_error`. The published `amount.minimum` is the op's, derived from the
  // bottom of the input band.
  builder.fly.swap('swapAllToWeth', {
    bind: { amountIn: exitPt.amountOut },
    config: {
      resourceOut: resources.erc20(WETH, BASE),
      // The exit is a same-block simulation, so only drift needs covering.
      inputVarianceBps: 50,
      // Price protection on the USDC/WETH pair, independent of the above.
      maxSlippageBps: 100,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: OWNER,
    inputs: {
      // 1 PT-USDC (6 decimals).
      amountIn: materialisers.directDeposit({ amount: '1000000' }),
    },
    // Load-bearing, not boilerplate: this is what returns the unconsumed input
    // to the sender if the exit over-delivers past the top of the band.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
