import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';

import { BASE_URL, OWNER } from './config.js';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave aEthUSDC receipt token on Ethereum mainnet
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';

/**
 * Swap WETH to USDC, then zap the USDC into an Aave lending position via LI.FI.
 *
 * Demonstrates:
 * - Chaining a swap into a zap by threading output handles
 * - The swap's amountOut feeds directly into the zap's amountIn
 * - Slippage guard on the zap output (swap output has providesMinimum)
 */
export const buildSwapAndZapExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // Declare the flow with a single WETH input on Ethereum mainnet.
  const builder = sdk.flow(1, {
    name: 'swap-and-zap-weth-to-aave',
    inputs: {
      amountIn: resources.erc20(WETH, 1),
    },
  });

  // Swap WETH → USDC via LI.FI.
  const swapOutputs = builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.03,
    },
  });

  // Zap the swapped USDC into Aave's aEthUSDC position via LI.FI.
  // The swap's amountOut handle is threaded directly into the zap's amountIn.
  builder.lifi.zap('zap', {
    bind: { amountIn: swapOutputs.amountOut },
    config: {
      resourceOut: resources.erc20(A_ETH_USDC, 1),
    },
    guards: [guards.slippage({ port: 'amountOut', bps: 100 })],
  });

  const flow = builder.build();

  // Build the compile request.
  // directDeposit transfers a fixed amount of WETH into the VM.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({
        amount: '1000000000000000000',
      }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
