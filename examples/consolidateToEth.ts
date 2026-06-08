import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

export interface ConsolidateToEthInput {
  readonly owner: Address;
  readonly wethAmount: `${bigint}`;
  readonly usdcAmount: `${bigint}`;
  readonly usdtAmount: `${bigint}`;
  readonly daiAmount: `${bigint}`;
}

const CHAIN_ID = 1;

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

/**
 * Consolidate ERC-20 token balances into native ETH on Ethereum mainnet.
 *
 * Demonstrates:
 * - Multiple resource inputs swapped to native ETH (not an ERC-20 target)
 * - resources.native() for the swap target
 * - directDeposit materialisers with fixed amounts (no on-chain balance read)
 */
export const buildConsolidateToEth = ({
  owner,
  wethAmount,
  usdcAmount,
  usdtAmount,
  daiAmount,
}: ConsolidateToEthInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });
  const erc20 = (token: Address) => resources.erc20(token, CHAIN_ID);

  // Declare the flow with one input per ERC-20 token on Ethereum mainnet.
  const builder = sdk.flow(CHAIN_ID, {
    name: 'consolidate-to-eth',
    inputs: {
      token_weth: erc20(WETH),
      token_usdc: erc20(USDC),
      token_usdt: erc20(USDT),
      token_dai: erc20(DAI),
    },
  });

  // Swap each token → native ETH via LI.FI with shared config.
  const swapConfig = {
    resourceOut: resources.native(CHAIN_ID),
    slippage: 0.03,
  };

  builder.lifi.swap('swap_token_weth', {
    bind: { amountIn: builder.inputs.token_weth },
    config: swapConfig,
  });
  builder.lifi.swap('swap_token_usdc', {
    bind: { amountIn: builder.inputs.token_usdc },
    config: swapConfig,
  });
  builder.lifi.swap('swap_token_usdt', {
    bind: { amountIn: builder.inputs.token_usdt },
    config: swapConfig,
  });
  builder.lifi.swap('swap_token_dai', {
    bind: { amountIn: builder.inputs.token_dai },
    config: swapConfig,
  });

  const flow = builder.build();

  // Build the compile request.
  // directDeposit materialisers transfer fixed amounts into the VM.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      token_weth: materialisers.directDeposit({ amount: wethAmount }),
      token_usdc: materialisers.directDeposit({ amount: usdcAmount }),
      token_usdt: materialisers.directDeposit({ amount: usdtAmount }),
      token_dai: materialisers.directDeposit({ amount: daiAmount }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
