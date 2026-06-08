import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  materialisers,
  preconditions,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Aave v3 contracts on Ethereum mainnet.
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';

export interface AaveRepayWithATokensInput {
  readonly owner: Address;
  readonly proxyAddress: Address;
  readonly expectedATokenBalance: `${bigint}`;
}

/**
 * Repay an Aave v3 variable-rate USDC debt by burning aToken collateral
 * already held by the proxy (no fresh asset transfer required).
 *
 * The aTokens are sourced from the proxy's existing balance via the
 * `balanceOf` materialiser. The `erc20Balance` precondition fails fast
 * if the expected aTokens haven't landed on the proxy yet.
 *
 * Demonstrates:
 * - `aave.repayWithATokens` with the aToken as the resource input.
 * - `balanceOf` materialiser to consume proxy-held aTokens directly.
 * - `erc20Balance` precondition to guard against silent zero-value repays.
 * - The `residual` port returns any aTokens not burned (when debt < input).
 */
export const buildAaveRepayWithATokens = ({
  owner,
  proxyAddress,
  expectedATokenBalance,
}: AaveRepayWithATokensInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'aave-repay-with-atokens',
    inputs: {
      aTokenIn: resources.erc20(A_ETH_USDC, 1),
    },
  });

  builder.aave.repayWithATokens('repay-atokens', {
    bind: { aTokenIn: builder.inputs.aTokenIn },
    config: {
      pool: AAVE_V3_POOL,
      asset: USDC,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      aTokenIn: materialisers.balanceOf({ owner: proxyAddress }),
    },
    preconditions: [
      preconditions.erc20Balance({
        wallet: proxyAddress,
        token: A_ETH_USDC,
        balance: expectedATokenBalance,
      }),
    ],
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
