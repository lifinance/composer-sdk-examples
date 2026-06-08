import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';

import { BASE_URL, OWNER } from './config.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/**
 * Swap WETH to USDC via LI.FI while collecting an integrator fee.
 *
 * Demonstrates:
 * - Setting `integratorFeeBps` on the compile request (50 bps = 0.5%)
 * - The fee is taken on the input token; the backend injects the fee transfer
 *
 * A non-zero `integratorFeeBps` requires the SDK to be configured with an
 * integration-scoped API key (`apiKey`); the integration is derived from the
 * key, not the request body.
 */
export const buildSwapWithFeeExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // Declare the flow with a single WETH input on Ethereum mainnet.
  const builder = sdk.flow(1, {
    name: 'swap-with-fee',
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

  // Build the compile request with a 50 bps (0.5%) integrator fee.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({
        amount: '1000000000000000000',
      }),
    },
    integratorFeeBps: 50,
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
