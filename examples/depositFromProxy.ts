import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  preconditions,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave v3 aEthUSDC receipt token on Ethereum mainnet
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';

export interface DepositFromProxyInput {
  readonly owner: Address;
  readonly proxyAddress: Address;
  readonly expectedAmount: `${bigint}`;
}

/**
 * Read tokens already on the proxy and deposit them into Aave.
 *
 * Demonstrates:
 * - `balanceOf` materialiser to source input from the proxy's existing
 *   token balance rather than transferring tokens in.
 * - `erc20Balance` precondition to assert the expected amount is present.
 *
 * Why the precondition matters:
 * `balanceOf` reads whatever balance happens to be on the proxy at
 * execution time. Without a precondition, the flow would silently
 * succeed with zero tokens if the expected funds never arrived (e.g.
 * a bridge transfer that hasn't landed yet). The precondition makes
 * the flow fail-fast with a clear error instead of executing a
 * worthless deposit.
 */
export const buildDepositFromProxy = ({
  owner,
  proxyAddress,
  expectedAmount,
}: DepositFromProxyInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'deposit-from-proxy',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Zap the USDC into Aave's aEthUSDC position.
  builder.lifi.zap('deposit', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(A_ETH_USDC, 1),
    },
    guards: [guards.slippage({ port: 'amountOut', bps: 100 })],
  });

  const flow = builder.build();

  // balanceOf reads the proxy's current USDC balance as the input.
  // The precondition guarantees at least `expectedAmount` is present —
  // without it, a delayed bridge would cause a silent zero-value deposit.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      amountIn: materialisers.balanceOf({ owner: proxyAddress }),
    },
    preconditions: [
      preconditions.erc20Balance({
        wallet: proxyAddress,
        token: USDC,
        balance: expectedAmount,
      }),
    ],
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
