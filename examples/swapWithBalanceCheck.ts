import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

export interface SwapWithBalanceCheckInput {
  readonly owner: Address;
  readonly amount: `${bigint}`;
}

/**
 * Swap WETH to USDC via LI.FI, then assert the execution contract holds
 * at least the swapped amount.
 *
 * Demonstrates:
 * - Using builder.context.executionAddress to reference the VM contract
 * - invariant.balanceAtLeast as a post-swap safety check
 * - No hardcoded contract address — the context provides it at compile time
 */
export const buildSwapWithBalanceCheck = ({
  owner,
  amount,
}: SwapWithBalanceCheckInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // Declare the flow with a single WETH input on Ethereum mainnet.
  const builder = sdk.flow(1, {
    name: 'swap-with-balance-check',
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

  // Assert the VM execution contract holds at least the swapped USDC amount.
  // builder.context.executionAddress resolves to the contract at compile time.
  builder.invariant.balanceAtLeast('check-usdc', {
    bind: {
      minimumAmount: swapOutputs.amountOut,
      account: builder.context.executionAddress,
    },
  });

  const flow = builder.build();

  // Build the compile request.
  // directDeposit transfers a fixed amount of WETH into the VM.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
