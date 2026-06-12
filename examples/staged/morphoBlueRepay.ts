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
  /** WETH supplied as collateral for the in-flow borrow (18 dp). */
  readonly collateralAmount: `${bigint}`;
  /** USDC borrowed against the collateral, then repaid by this flow (6 dp). */
  readonly borrowAmount: `${bigint}`;
  /**
   * USDC deposited to repay the debt (6 dp). Must exceed `borrowAmount`:
   * Morpho's share rounding can leave the debt a wei above the borrowed
   * amount, so the `max`-mode repay needs a little headroom. The leftover
   * surfaces on the `residual` port.
   */
  readonly repayAmount: `${bigint}`;
}

/**
 * Open and close a Morpho Blue WETH/USDC position on Base in one flow —
 * a self-contained supplyCollateral → borrow → repay → withdrawCollateral
 * round trip that creates the debt it retires.
 *
 * Demonstrates:
 * - `morphoBlue.supplyCollateral` to post WETH (collateral is internal
 *   position state — no receipt token).
 * - `morphoBlue.borrow` to mint USDC debt against it.
 * - `morphoBlue.repay` with `mode: 'max'`, which reads the proxy's current
 *   `borrowShares` on-chain and repays in shares mode to retire the debt to
 *   the wei. Unused USDC surfaces on the `residual` Resource port.
 * - `morphoBlue.withdrawCollateral` to pull the freed WETH once the debt
 *   is cleared.
 * - `sweepTo` to return the borrowed USDC, the repay residual, and the
 *   freed WETH to the signer.
 */
export const buildMorphoBlueRepay = ({
  owner,
  collateralAmount,
  borrowAmount,
  repayAmount,
}: MorphoBlueRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(8453, {
    name: 'morpho-blue-repay-usdc-withdraw-weth',
    inputs: {
      collateralIn: resources.erc20(BASE_WETH, 8453),
      repayIn: resources.erc20(BASE_USDC, 8453),
    },
  });

  // Post WETH collateral so the proxy can open the debt it will repay.
  builder.morphoBlue.supplyCollateral('supply-collateral', {
    bind: {
      assetIn: builder.inputs.collateralIn,
    },
    config: {
      marketParams: WETH_USDC_MARKET,
      mode: 'exact',
    },
  });

  // Borrow USDC against the collateral; the borrowed USDC stays on the
  // proxy as a terminal resource and is swept back to the signer.
  builder.morphoBlue.borrow('borrow', {
    bind: {},
    config: {
      marketParams: WETH_USDC_MARKET,
      amount: borrowAmount,
    },
  });

  // Retire the just-opened debt from the deposited USDC. mode 'max' reads
  // the live borrowShares and repays in shares mode, clearing the debt to
  // the wei; the unused USDC surfaces on the `residual` port.
  builder.morphoBlue.repay('repay', {
    bind: {
      assetIn: builder.inputs.repayIn,
      onBehalfOf: builder.context.executionAddress,
    },
    config: {
      marketParams: WETH_USDC_MARKET,
      mode: 'max',
    },
  });

  // The debt is cleared, so the full collateral can be withdrawn. The freed
  // WETH lands on the proxy and is swept to the signer.
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
      collateralIn: materialisers.directDeposit({ amount: collateralAmount }),
      repayIn: materialisers.directDeposit({ amount: repayAmount }),
    },
    // Sweep the borrowed USDC, the repay residual, and the freed WETH back
    // to the signer.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
