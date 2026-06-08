import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Aave v3 contracts on Ethereum mainnet.
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

export interface AaveRepayInput {
  readonly owner: Address;
  readonly amount: `${bigint}`;
}

/**
 * Repay an Aave v3 variable-rate WETH debt by supplying WETH to the proxy.
 *
 * Aave internally caps the repay at `min(amount, outstandingDebt)`, so the
 * op returns any unspent WETH on the `residual` resource port. The
 * residual is swept back to the sender on completion.
 *
 * Demonstrates:
 * - `aave.repay` with a resource input (the WETH used to repay).
 * - Binding `onBehalfOf` from the runtime context — the proxy repays its
 *   own debt position.
 * - The `residual` port for surfacing any unused input back to the caller.
 */
export const buildAaveRepay = ({
  owner,
  amount,
}: AaveRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'aave-repay-weth',
    inputs: {
      assetIn: resources.erc20(WETH, 1),
    },
  });

  builder.aave.repay('repay', {
    bind: {
      assetIn: builder.inputs.assetIn,
      onBehalfOf: builder.context.executionAddress,
    },
    config: {
      pool: AAVE_V3_POOL,
      mode: 'exact',
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      assetIn: materialisers.directDeposit({ amount }),
    },
    // Any unspent WETH (residual) is swept back to the signer.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
