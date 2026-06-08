import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';

import { BASE_URL, OWNER } from './config.js';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

/**
 * Split USDC 80/20, swap only the 80% portion to USDT, and sweep the
 * remaining 20% back to the sender as dust.
 *
 * Demonstrates:
 * - Dust recovery via `sweepTo`. When a flow produces leftover tokens
 *   that are not consumed by any downstream operation, those tokens
 *   remain on the proxy contract. `sweepTo` tells the backend to
 *   transfer all residual token balances to the specified address
 *   at the end of execution.
 * - In this example the 20% USDC from the split is intentionally
 *   unused — it becomes dust that `sweepTo` returns to the sender.
 */
export const buildDustSweepExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'dust-sweep',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Split USDC 80/20.
  // Only the 80% portion (`a`) is consumed by the swap.
  // The 20% portion (`b`) is intentionally left unbound — it stays on
  // the proxy as dust and gets swept back to the sender.
  const { a } = builder.core.split('split', {
    bind: { source: builder.inputs.amountIn },
    config: { bps: 8000 },
  });

  // Swap only the 80% portion to USDT.
  builder.lifi.swap('swap', {
    bind: { amountIn: a },
    config: {
      resourceOut: resources.erc20(USDT, 1),
      slippage: 0.03,
    },
  });

  const flow = builder.build();

  // `sweepTo` ensures the unused 20% USDC is transferred back to the
  // sender rather than being left stranded on the proxy contract.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '10000000' }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
