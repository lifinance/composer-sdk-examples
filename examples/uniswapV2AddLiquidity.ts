import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

// Ethereum mainnet (chainId 1).
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const USDC_WETH_PAIR = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc';

// Tolerance of the swap leg: the aggregator's `toAmountMin` lets the swap
// deliver up to 3% less WETH than quoted.
const SWAP_SLIPPAGE = 0.03;

export interface UniswapV2AddLiquidityInput {
  readonly owner: Address;
  readonly usdcAmount: `${bigint}`;
}

/**
 * Deposit USDC alone into the Uniswap V2 USDC/WETH pair.
 *
 * - `core.split` halves the USDC input.
 * - `lifi.swap` turns one half into WETH.
 * - `uniswapV2.addLiquidity` deposits the other USDC half and the swapped
 *   WETH, minting the UNI-V2 LP token. Unused input comes back as residuals.
 * - The request sweeps the LP token and the residuals to the signer.
 */
export const buildUniswapV2AddLiquidity = ({
  owner,
  usdcAmount,
}: UniswapV2AddLiquidityInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(1, {
    name: 'uniswap-v2-add-liquidity-usdc-weth',
    inputs: {
      usdcIn: resources.erc20(USDC, 1),
    },
  });

  const { a: usdcHalf, b: usdcToSwap } = builder.core.split('split', {
    bind: { source: builder.inputs.usdcIn },
    config: { bps: 5000 },
  });

  const swap = builder.lifi.swap('swap', {
    bind: { amountIn: usdcToSwap },
    config: {
      resourceOut: resources.erc20(WETH, 1),
      slippage: SWAP_SLIPPAGE,
    },
  });

  builder.uniswapV2.addLiquidity('add-liquidity', {
    bind: {
      tokenA: usdcHalf,
      tokenB: swap.amountOut,
    },
    config: {
      router: UNISWAP_V2_ROUTER,
      factory: UNISWAP_V2_FACTORY,
      pair: USDC_WETH_PAIR,
    },
    guards: [
      // The router is called with zero minimums, so this band is the sandwich
      // protection: it reverts unless the pool price read before the deposit
      // stays within ±50 bps of the simulated price. It does not depend on the
      // swap leg.
      guards.band({ port: 'poolPrice', bps: 50 }),
      // A swap that fills at its 3% minimum delivers less WETH, so the add
      // mints less LP. The floor must cover that tolerance (300 bps) plus the
      // 50 bps band, or a valid swap fill reverts the transaction.
      guards.slippage({ port: 'liquidity', bps: 350 }),
    ],
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      usdcIn: materialisers.directDeposit({ amount: usdcAmount }),
    },
    // Sweep the LP token and the unused USDC/WETH back to the signer.
    sweepTo: builder.context.sender,
    // The UNI-V2 LP token is unpriced, so the default 500 bps price-impact
    // check reads the deposit as a 100% loss. 0 skips the check; the `band`
    // and `slippage` guards above are the protection.
    maxPriceImpactBps: 0,
  });

  return { flow, request };
};
