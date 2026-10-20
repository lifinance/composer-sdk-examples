import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

const BASE = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
// Aave V3 aToken for WETH on Base.
const A_BAS_WETH = '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7';
const VALIDITY_WINDOW_MS = 3_600_000;

export interface ContinuationSettleInput {
  readonly owner: Address;
  // Receives the aBasWETH position; defaults to `owner`.
  readonly recipient?: Address;
}

/**
 * Swap USDC to WETH on Base, then escrow the WETH for a deferred settlement
 * whose leg supplies it to Aave and delivers the aBasWETH position to the
 * recipient.
 *
 * Demonstrates:
 * - `continuation.settle` funded by an upstream output (`swap.amountOut`)
 * - The leg (`continuationFlow`) as an ordinary flow built with `sdk.flow`
 *   and assigned with `leg.build()`: here one `lifi.zap` that supplies the
 *   escrowed WETH to Aave
 * - An outcome in the token the leg produces (aBasWETH): the zap's slippage
 *   guard proves the floor, so `minAmount` is omitted
 * - `refund` naming the address that receives the escrow balance on expiry
 *   and the leg's residual (optional; defaults to the signer)
 *
 * The leg contract:
 * - Exactly one input: a resource input in the funding token on the escrow
 *   chain. The solver binds the escrow balance to it.
 * - Produce each outcome into the leg's own proxy and end there. A zap or a
 *   deposit mints into the proxy by default; a node that needs a receiver
 *   binds `leg.context.executionAddress`. A funding input no node consumes
 *   stays in the proxy as the terminal `input.<name>`. Never
 *   pay a recipient: not `destination`, not the provider's settlement
 *   recipient, and never `context.sender` (inside the leg that is the
 *   settlement account, not the user). Never set the leg's own epilogue. At
 *   commit the composer appends the settlement epilogue, which forwards each
 *   outcome to the provider's recipient and the residual to `refund`.
 * - Omit `funding` when the settle input is a bridge's
 *   `amountOut` (see `continuationBridgeSettle.ts`).
 * - `minAmount` is optional: a guard or an op floor on the outcome token
 *   proves it, and an unconsumed funding input proves the full funding floor.
 */
export const buildContinuationSettleExample = ({
  owner,
  recipient = owner,
}: ContinuationSettleInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // The leg: runs from the escrow on Base once the WETH has landed there. The
  // zap supplies the WETH to Aave; the aBasWETH it mints lands in the leg's
  // proxy, where the settlement epilogue picks it up. The slippage guard on
  // `amountOut` is the enforced floor the compiler commits.
  const leg = sdk.flow(BASE, {
    name: 'settle-leg',
    inputs: { funding: resources.erc20(WETH, BASE) },
  });
  leg.lifi.zap('supply', {
    bind: { amountIn: leg.inputs.funding },
    config: { resourceOut: resources.erc20(A_BAS_WETH, BASE) },
    guards: [guards.slippage({ port: 'amountOut', bps: 50 })],
  });

  // The main flow: swap USDC to WETH, then escrow the WETH for the leg.
  const builder = sdk.flow(BASE, {
    name: 'swap-and-settle',
    inputs: { amountIn: resources.erc20(USDC, BASE) },
  });
  const swap = builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: { resourceOut: resources.erc20(WETH, BASE) },
  });
  builder.continuation.settle('settle', {
    bind: { input: swap.amountOut },
    config: {
      outcomes: [{ token: A_BAS_WETH, destination: recipient, chainId: BASE }],
      validity: { expiresAtMs: Date.now() + VALIDITY_WINDOW_MS },
      provider: 'intent-factory',
      refund: owner,
      continuationFlow: leg.build(),
    },
  });

  const flow = builder.build();

  // No `sweepTo`: the swap output funds the escrow and the settle output is
  // delivered by the settlement, never landing in the VM.
  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '1000000000' }),
    },
  });

  return { flow, request };
};
