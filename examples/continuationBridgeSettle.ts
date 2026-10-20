import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

const ARBITRUM = 42161;
const BASE = 8453;
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Aave V3 aToken for USDC on Base.
const A_BAS_USDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';
const VALIDITY_WINDOW_MS = 3_600_000;

export interface ContinuationBridgeSettleInput {
  readonly owner: Address;
  // Receives the aBasUSDC position on Base; defaults to `owner`.
  readonly recipient?: Address;
}

/**
 * Bridge USDC from Arbitrum to Base, and escrow the bridged USDC on Base for a
 * deferred settlement that supplies it to Aave and delivers the aBasUSDC
 * position to the recipient.
 *
 * Demonstrates:
 * - `lifi.bridge` with no `destination`: its `amountOut` funds the settle's
 *   escrow on Base instead of landing at an address
 * - `continuation.settle` bound to `bridge.amountOut` (delivered funding): the
 *   bridge delivers straight into the escrow, so the user signs one
 *   transaction on Arbitrum, and the settle must omit `funding`
 * - `validity.expiresAtMs` at least `max(3 × the bridge ETA, 30 minutes)` away
 * - A leg on the escrow chain (Base) that does the work the user could not do
 *   from Arbitrum: `lifi.zap` supplies the landed USDC to Aave. The aBasUSDC
 *   stays in the leg's proxy; the settlement epilogue the composer appends at
 *   commit forwards it to the recipient
 * - An outcome in a token the leg produces (aBasUSDC), not the funding token:
 *   the zap's slippage guard proves the floor, so `minAmount` is omitted
 */
export const buildContinuationBridgeSettleExample = ({
  owner,
  recipient = owner,
}: ContinuationBridgeSettleInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // The leg: runs from the escrow on Base once the bridged USDC has landed.
  // The zap supplies the USDC to Aave; the aBasUSDC it mints lands in the
  // leg's proxy, where the settlement epilogue picks it up. The slippage guard
  // on `amountOut` is the enforced floor the compiler commits.
  const leg = sdk.flow(BASE, {
    name: 'bridge-settle-leg',
    inputs: { funding: resources.erc20(BASE_USDC, BASE) },
  });
  leg.lifi.zap('supply', {
    bind: { amountIn: leg.inputs.funding },
    config: { resourceOut: resources.erc20(A_BAS_USDC, BASE) },
    guards: [guards.slippage({ port: 'amountOut', bps: 50 })],
  });

  // The main flow on Arbitrum: bridge to Base, then escrow the delivery.
  const builder = sdk.flow(ARBITRUM, {
    name: 'bridge-and-settle',
    inputs: { amountIn: resources.erc20(ARB_USDC, ARBITRUM) },
  });
  const bridge = builder.lifi.bridge('bridge', {
    bind: { amountIn: builder.inputs.amountIn },
    config: { resourceOut: resources.erc20(BASE_USDC, BASE) },
  });
  builder.continuation.settle('settle', {
    bind: { input: bridge.amountOut },
    config: {
      outcomes: [{ token: A_BAS_USDC, destination: recipient, chainId: BASE }],
      validity: { expiresAtMs: Date.now() + VALIDITY_WINDOW_MS },
      provider: 'intent-factory',
      refund: owner,
      continuationFlow: leg.build(),
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '1000000000' }),
    },
  });

  return { flow, request };
};
