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
const DAI = '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb';
// Aave V3 aToken for USDC on Base.
const A_BAS_USDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';
const VALIDITY_WINDOW_MS = 3_600_000;

export interface ContinuationTwoOutcomesInput {
  readonly owner: Address;
  // Receives the DAI and the aBasUSDC position; defaults to `owner`.
  readonly recipient?: Address;
}

/**
 * Escrow 1,000 USDC on Base for a deferred settlement whose leg partitions it
 * 50/50, swaps one half to DAI and supplies the other half to Aave, and
 * delivers both the DAI and the aBasUSDC position to the recipient.
 *
 * Demonstrates:
 * - One `continuation.settle` node committing two outcomes from one escrow:
 *   both on one chain, each token once
 * - `settle.outcomes[0]` (DAI) and `settle.outcomes[1]` (aBasUSDC): one
 *   output handle per outcome, in `config.outcomes` order, reported as
 *   `outputs['settle.outcomes.0']` and `outputs['settle.outcomes.1']`
 * - Floors proven by the leg, so `minAmount` is omitted: the swap's quoted
 *   minimum floors the DAI, the zap's slippage guard floors the aBasUSDC
 * - A funding token (USDC) that is not an outcome: the leg's residual USDC
 *   goes to `refund`
 *
 * The settlement contract checks every outcome's floor, so a fill that
 * misses either one reverts and delivers neither. See `continuationSettle.ts`
 * for the leg contract.
 */
export const buildContinuationTwoOutcomesExample = ({
  owner,
  recipient = owner,
}: ContinuationTwoOutcomesInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // The leg: runs from the escrow on Base once the USDC has landed there.
  // Both outcomes land in the leg's proxy, where the settlement epilogue
  // picks them up.
  const leg = sdk.flow(BASE, {
    name: 'two-outcome-leg',
    inputs: { funding: resources.erc20(USDC, BASE) },
  });
  const [toSwap, toSupply] = leg.core.partition('split', {
    bind: { source: leg.inputs.funding },
    config: { bps: [5000, 5000] },
  }).parts;
  leg.lifi.swap('swap', {
    bind: { amountIn: toSwap },
    config: { resourceOut: resources.erc20(DAI, BASE) },
  });
  leg.lifi.zap('supply', {
    bind: { amountIn: toSupply },
    config: { resourceOut: resources.erc20(A_BAS_USDC, BASE) },
    guards: [guards.slippage({ port: 'amountOut', bps: 50 })],
  });

  // The main flow: escrow the deposited USDC for the leg.
  const builder = sdk.flow(BASE, {
    name: 'settle-two-outcomes',
    inputs: { amountIn: resources.erc20(USDC, BASE) },
  });
  builder.continuation.settle('settle', {
    bind: { input: builder.inputs.amountIn },
    config: {
      outcomes: [
        { token: DAI, destination: recipient, chainId: BASE },
        { token: A_BAS_USDC, destination: recipient, chainId: BASE },
      ],
      validity: { expiresAtMs: Date.now() + VALIDITY_WINDOW_MS },
      provider: 'intent-factory',
      refund: owner,
      continuationFlow: leg.build(),
    },
  });

  const flow = builder.build();

  // No `sweepTo`: the deposit funds the escrow and both outcomes are
  // delivered by the settlement, never landing in the VM.
  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '1000000000' }),
    },
  });

  return { flow, request };
};
