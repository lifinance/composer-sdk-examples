import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';

import { API_KEY, BASE_URL, OWNER } from './config.js';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave v3 aEthUSDC receipt token on Ethereum mainnet
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';
// Steakhouse USDC (Morpho MetaMorpho vault) on Ethereum mainnet
const STEAKHOUSE_USDC = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

/**
 * Split USDC 60/40 and zap each portion into a different vault.
 *
 * Demonstrates:
 * - core.partition to divide a resource into one part per basis-point share
 * - Destructuring the typed `parts` tuple into two independent lifi.zap nodes
 * - Slippage guards on both zap outputs
 */
export const buildSplitAndZapExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(1, {
    name: 'split-usdc-to-two-vaults',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Partition USDC 60/40 — one part per `bps` entry. Every part but the last
  // is rounded down; the last takes the remainder.
  const [toAave, toMorpho] = builder.core.partition('split', {
    bind: { source: builder.inputs.amountIn },
    config: { bps: [6000, 4000] },
  }).parts;

  // Zap 60% into Aave v3 aEthUSDC.
  builder.lifi.zap('zap-aave', {
    bind: { amountIn: toAave },
    config: {
      resourceOut: resources.erc20(A_ETH_USDC, 1),
    },
    guards: [guards.slippage({ port: 'amountOut', bps: 100 })],
  });

  // Zap 40% into Steakhouse USDC (Morpho).
  builder.lifi.zap('zap-morpho', {
    bind: { amountIn: toMorpho },
    config: {
      resourceOut: resources.erc20(STEAKHOUSE_USDC, 1),
    },
    guards: [guards.slippage({ port: 'amountOut', bps: 100 })],
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '10000000000' }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
