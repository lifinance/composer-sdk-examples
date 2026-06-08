import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

export interface ConsolidateStablesToUsdcInput {
  readonly owner: Address;
  readonly usdtAmount: `${bigint}`;
  readonly daiAmount: `${bigint}`;
  readonly fraxAmount: `${bigint}`;
  readonly lusdAmount: `${bigint}`;
}

const CHAIN_ID = 1;
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const FRAX = '0x853d955aCEf822Db058eb8505911ED77F175b99e';
const LUSD = '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0';

/**
 * Consolidate blue-chip stablecoin balances into USDC on Ethereum mainnet.
 *
 * Demonstrates:
 * - Multiple resource inputs (four stablecoins)
 * - Shared swap config reused across all nodes
 * - directDeposit materialisers with fixed amounts (no on-chain balance read)
 */
export const buildConsolidateStablesToUsdc = ({
  owner,
  usdtAmount,
  daiAmount,
  fraxAmount,
  lusdAmount,
}: ConsolidateStablesToUsdcInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });
  const erc20 = (token: Address) => resources.erc20(token, CHAIN_ID);

  // Declare the flow with one input per stablecoin on Ethereum mainnet.
  const builder = sdk.flow(CHAIN_ID, {
    name: 'consolidate-stables-to-usdc',
    inputs: {
      stable_usdt: erc20(USDT),
      stable_dai: erc20(DAI),
      stable_frax: erc20(FRAX),
      stable_lusd: erc20(LUSD),
    },
  });

  // Swap each stablecoin → USDC via LI.FI with shared config.
  const swapConfig = {
    resourceOut: resources.erc20(USDC, CHAIN_ID),
    slippage: 0.03,
  };

  builder.lifi.swap('swap_stable_usdt', {
    bind: { amountIn: builder.inputs.stable_usdt },
    config: swapConfig,
  });
  builder.lifi.swap('swap_stable_dai', {
    bind: { amountIn: builder.inputs.stable_dai },
    config: swapConfig,
  });
  builder.lifi.swap('swap_stable_frax', {
    bind: { amountIn: builder.inputs.stable_frax },
    config: swapConfig,
  });
  builder.lifi.swap('swap_stable_lusd', {
    bind: { amountIn: builder.inputs.stable_lusd },
    config: swapConfig,
  });

  const flow = builder.build();

  // Build the compile request.
  // directDeposit materialisers transfer fixed amounts into the VM.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      stable_usdt: materialisers.directDeposit({ amount: usdtAmount }),
      stable_dai: materialisers.directDeposit({ amount: daiAmount }),
      stable_frax: materialisers.directDeposit({ amount: fraxAmount }),
      stable_lusd: materialisers.directDeposit({ amount: lusdAmount }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
