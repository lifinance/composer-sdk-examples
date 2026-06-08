import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';

import { BASE_URL, OWNER } from './config.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/**
 * Swap WETH to USDC on Ethereum mainnet via LI.FI.
 *
 * Demonstrates:
 * - Simplest possible single-swap flow
 * - directDeposit materialiser with a fixed amount
 * - No slippage guard needed — lifi.swap's amountOut already providesMinimum
 */
export const buildLifiSwapExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // Declare the flow with a single WETH input on Ethereum mainnet.
  const builder = sdk.flow(1, {
    name: 'swap-weth-to-usdc',
    inputs: {
      amountIn: resources.erc20(WETH, 1),
    },
  });

  // Swap WETH → USDC via LI.FI.
  builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.03,
    },
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
