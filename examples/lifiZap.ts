import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';

import { BASE_URL, OWNER } from './config.js';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave aEthUSDC receipt token on Ethereum mainnet
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';

/**
 * Zap USDC into an Aave lending position on Ethereum mainnet via LI.FI.
 *
 * Demonstrates:
 * - Simplest possible single-zap flow
 * - Slippage guard on the zap output (allowed because amountOut does not providesMinimum)
 * - directDeposit materialiser with a fixed amount
 */
export const buildLifiZapExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // Declare the flow with a single USDC input on Ethereum mainnet.
  const builder = sdk.flow(1, {
    name: 'zap-usdc-to-aave',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Zap USDC into Aave's aEthUSDC position via LI.FI.
  // Slippage guard asserts the output is within 1% (100 bps) of the expected amount.
  builder.lifi.zap('zap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(A_ETH_USDC, 1),
    },
    guards: [guards.slippage({ port: 'amountOut', bps: 100 })],
  });

  const flow = builder.build();

  // Build the compile request.
  // directDeposit transfers a fixed amount of USDC into the VM.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '1000000000' }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
