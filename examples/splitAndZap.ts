import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';

import { BASE_URL, OWNER } from './config.js';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave v3 aEthUSDC receipt token on Ethereum mainnet
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';
// Steakhouse USDC (Morpho MetaMorpho vault) on Ethereum mainnet
const STEAKHOUSE_USDC = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

/**
 * Split USDC 60/40 and zap each portion into a different vault.
 *
 * Demonstrates:
 * - core.split to divide a resource by basis-point ratio
 * - Threading split outputs into two independent lifi.zap nodes
 * - Slippage guards on both zap outputs
 */
export const buildSplitAndZapExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'split-usdc-to-two-vaults',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Split USDC 60/40 — 6000 bps to `a`, remainder to `b`.
  const { a, b } = builder.core.split('split', {
    bind: { source: builder.inputs.amountIn },
    config: { bps: 6000 },
  });

  // Zap 60% into Aave v3 aEthUSDC.
  builder.lifi.zap('zap-aave', {
    bind: { amountIn: a },
    config: {
      resourceOut: resources.erc20(A_ETH_USDC, 1),
    },
    guards: [guards.slippage({ port: 'amountOut', bps: 100 })],
  });

  // Zap 40% into Steakhouse USDC (Morpho).
  builder.lifi.zap('zap-morpho', {
    bind: { amountIn: b },
    config: {
      resourceOut: resources.erc20(STEAKHOUSE_USDC, 1),
    },
    guards: [guards.slippage({ port: 'amountOut', bps: 100 })],
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '10000000000' }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
