import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

// Uniswap V3 USDC/WETH 0.05% pool on Ethereum mainnet (chainId 1).
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const POSITION_MANAGER = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const USDC_WETH_500_POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';
// Full range: the widest ticks that are multiples of the pool's tick spacing (10).
const TICK_LOWER = -887270;
const TICK_UPPER = 887270;

export interface UniswapV3MintInput {
  readonly owner: Address;
  readonly usdcAmount: `${bigint}`;
  readonly wethAmount: `${bigint}`;
}

/**
 * Open a full-range Uniswap V3 USDC/WETH position on Ethereum mainnet.
 *
 * - `uniswapV3.mint` deposits the proxy's USDC and WETH and mints the
 *   position NFT straight to the signer.
 * - Unused USDC or WETH comes back as residuals, swept to the signer.
 */
export const buildUniswapV3Mint = ({
  owner,
  usdcAmount,
  wethAmount,
}: UniswapV3MintInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(1, {
    name: 'uniswap-v3-mint-usdc-weth',
    inputs: {
      usdc: resources.erc20(USDC, 1),
      weth: resources.erc20(WETH, 1),
    },
  });

  builder.uniswapV3.mint('mint', {
    bind: {
      tokenA: builder.inputs.usdc,
      tokenB: builder.inputs.weth,
      recipient: builder.context.sender,
    },
    config: {
      positionManager: POSITION_MANAGER,
      factory: FACTORY,
      pool: USDC_WETH_500_POOL,
      fee: 500,
      tickLower: TICK_LOWER,
      tickUpper: TICK_UPPER,
    },
    guards: [
      // Bound the pool price before the deposit; N bps on the sqrt price
      // allows about 2N bps of price movement, so this caps it near 50 bps.
      guards.band({ port: 'sqrtPriceX96', bps: 25 }),
      // Floor the minted liquidity. Liquidity is a handle, not a resource,
      // so no minimum appears in the response.
      guards.slippage({ port: 'liquidity', bps: 50 }),
    ],
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      usdc: materialisers.directDeposit({ amount: usdcAmount }),
      weth: materialisers.directDeposit({ amount: wethAmount }),
    },
    // Return unused USDC or WETH to the signer.
    sweepTo: builder.context.sender,
    // The position NFT is not a resource, so only the residuals count as
    // output and the default price-impact check would read a full loss.
    // 0 skips the check; the band and slippage guards protect the deposit.
    maxPriceImpactBps: 0,
  });

  return { flow, request };
};
