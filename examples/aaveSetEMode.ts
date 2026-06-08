import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Aave v3 contracts on Ethereum mainnet.
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';

// Mainnet ETH-correlated eMode category. Categories are per-pool; check
// `Pool.getEModeCategoryData(id)` on the target chain before reusing this id.
const ETH_CORRELATED_CATEGORY = 1;

export interface AaveSetEModeInput {
  readonly owner: Address;
}

/**
 * Switch the executionAddress's Aave v3 eMode category.
 *
 * eMode is a per-user setting on the pool that allows higher LTV when both
 * collateral and debt are correlated assets (e.g. ETH-LSTs, stablecoins).
 * The setting persists across transactions until changed again.
 *
 * Demonstrates:
 * - `aave.setEMode` as a side-effecting op with no resource inputs or outputs.
 * - The op's category is validated at request-validation time against the
 *   protocol's uint8 range. Per-pool category existence (Ethereum has 40+
 *   categories, Base has 15+, Arbitrum 10+; new ones are added by governance)
 *   is verified at simulation time, not in the schema.
 *
 * Real flows typically combine this op with `aave.supply` + `aave.borrow` of
 * correlated assets. The reset call (`category: 0`) is intentionally omitted —
 * leaving eMode on persists the leveraged position past the tx, and resetting
 * to 0 after a high-LTV borrow would revert with a sub-1 health factor.
 */
export const buildAaveSetEMode = ({
  owner,
}: AaveSetEModeInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'aave-set-emode',
    inputs: {},
  });

  builder.aave.setEMode('enter-eth-emode', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL,
      category: ETH_CORRELATED_CATEGORY,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {},
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
