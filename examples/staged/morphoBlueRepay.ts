import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { BASE_URL } from '../config.js';

// Morpho Blue WETH/USDC market on Base (chainId 8453).
const ADAPTIVE_CURVE_IRM_BASE = '0x46415998764C29aB2a25CbeA6254146D50D22687';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const WETH_USDC_ORACLE = '0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4';
const WETH_USDC_LLTV = '860000000000000000';

const WETH_USDC_MARKET = {
  loanToken: BASE_USDC,
  collateralToken: BASE_WETH,
  oracle: WETH_USDC_ORACLE,
  irm: ADAPTIVE_CURVE_IRM_BASE,
  lltv: WETH_USDC_LLTV,
};

export interface MorphoBlueRepayInput {
  readonly owner: Address;
  readonly repayAmount: `${bigint}`;
  readonly collateralAmount: `${bigint}`;
}

/**
 * Close a Morpho Blue WETH/USDC position on Base:
 *
 * - User direct-deposits USDC (slightly over-funded to exercise the residual
 *   port).
 * - `morphoBlue.repay` with `mode: 'max'` reads the proxy's current
 *   `borrowShares` via a precursor `Morpho.position` static call and passes
 *   the share count back into `repay` to retire the debt to the wei. Any
 *   unused USDC surfaces on the `residual` Resource port.
 * - `morphoBlue.withdrawCollateral` pulls the freed WETH back to the signer's
 *   wallet.
 * - The flow sweeps both the freed WETH and the USDC residual to the signer.
 */
export const buildMorphoBlueRepay = ({
  owner,
  repayAmount,
  collateralAmount,
}: MorphoBlueRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(8453, {
    name: 'morpho-blue-repay-usdc-withdraw-weth',
    inputs: {
      assetIn: resources.erc20(BASE_USDC, 8453),
    },
  });

  builder.morphoBlue.repay('repay', {
    bind: {
      assetIn: builder.inputs.assetIn,
      onBehalfOf: builder.context.executionAddress,
    },
    config: {
      marketParams: WETH_USDC_MARKET,
      mode: 'max',
    },
  });

  // The withdrawn WETH lands on the proxy; the request-level `sweepTo`
  // pushes it (and the USDC `residual` from the repay) to the signer.
  builder.morphoBlue.withdrawCollateral('withdraw-collateral', {
    bind: {},
    config: {
      marketParams: WETH_USDC_MARKET,
      amount: collateralAmount,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      assetIn: materialisers.directDeposit({ amount: repayAmount }),
    },
    // Sweep freed WETH and the USDC residual back to the signer.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
