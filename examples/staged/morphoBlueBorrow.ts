import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { BASE_URL } from '../config.js';

// Morpho Blue WETH/USDC market on Base (chainId 8453).
// The Morpho singleton address (0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb)
// is the default `morpho` config field and is read from compose-builtins.
const ADAPTIVE_CURVE_IRM_BASE = '0x46415998764C29aB2a25CbeA6254146D50D22687';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const WETH_USDC_ORACLE = '0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4';
const WETH_USDC_LLTV = '860000000000000000'; // 0.86e18

const WETH_USDC_MARKET = {
  loanToken: BASE_USDC,
  collateralToken: BASE_WETH,
  oracle: WETH_USDC_ORACLE,
  irm: ADAPTIVE_CURVE_IRM_BASE,
  lltv: WETH_USDC_LLTV,
};

export interface MorphoBlueBorrowInput {
  readonly owner: Address;
  readonly collateralAmount: `${bigint}`;
  readonly borrowAmount: `${bigint}`;
}

/**
 * Open a leveraged-borrow position on the Base Morpho Blue WETH/USDC market.
 *
 * - `morphoBlue.supplyCollateral` debits the proxy's WETH and credits
 *   `Morpho.position(WETH_USDC_MARKET_ID, proxy).collateral`. There is no
 *   receipt token — collateral is non-transferable accounting state.
 * - `morphoBlue.borrow` mints debt shares against that collateral and
 *   transfers USDC to the proxy. The borrowed asset is exposed as the
 *   `borrowed` Resource port for downstream nodes.
 * - The flow sweeps the borrowed USDC back to the signer's wallet via
 *   `sweepTo` on the request.
 */
export const buildMorphoBlueBorrow = ({
  owner,
  collateralAmount,
  borrowAmount,
}: MorphoBlueBorrowInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(8453, {
    name: 'morpho-blue-borrow-weth-usdc',
    inputs: {
      assetIn: resources.erc20(BASE_WETH, 8453),
    },
  });

  builder.morphoBlue.supplyCollateral('supply-collateral', {
    bind: {
      assetIn: builder.inputs.assetIn,
    },
    config: {
      marketParams: WETH_USDC_MARKET,
      mode: 'exact',
    },
  });

  builder.morphoBlue.borrow('borrow', {
    bind: {},
    config: {
      marketParams: WETH_USDC_MARKET,
      amount: borrowAmount,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      assetIn: materialisers.directDeposit({ amount: collateralAmount }),
    },
    // Sweep the borrowed USDC back to the signer.
    sweepTo: builder.context.sender,
    // The WETH collateral becomes unpriced Morpho position state (no receipt
    // token), so the default 500 bps price-impact check reads any safe borrow
    // (LLTV caps at 86%) as a loss. 0 skips the check.
    maxPriceImpactBps: 0,
  });

  return { flow, request };
};
