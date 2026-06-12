import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import {
  padForAaveDebtRounding,
  trimForAaveWithdrawalRounding,
} from '../aaveRounding.js';
import { BASE_URL } from '../config.js';

// Base mainnet token addresses.
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Aave V3 on Base (pool + aWETH receipt + variable-debt USDC).
const AAVE_V3_POOL_BASE = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const A_BAS_WETH = '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7';
const VDEBT_BAS_USDC = '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28';

// Morpho Blue WETH/USDC market on Base (same parameters as the
// `morphoBlueBorrow` / `morphoBlueRepay` examples).
const ADAPTIVE_CURVE_IRM_BASE = '0x46415998764C29aB2a25CbeA6254146D50D22687';
const WETH_USDC_ORACLE = '0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4';
const WETH_USDC_LLTV = '860000000000000000';

const MORPHO_WETH_USDC_MARKET = {
  loanToken: BASE_USDC,
  collateralToken: BASE_WETH,
  oracle: WETH_USDC_ORACLE,
  irm: ADAPTIVE_CURVE_IRM_BASE,
  lltv: WETH_USDC_LLTV,
};

export interface AaveToMorphoDebtMigrationInput {
  readonly owner: Address;
  /** WETH collateral the user posts (in smallest units). */
  readonly collateralAmount: `${bigint}`;
  /** USDC principal borrowed from Aave (in smallest units). */
  readonly debtAmount: `${bigint}`;
  /**
   * Aave-V3 flashloan fee on `debtAmount` — equals
   * `computeDefaultFee('aave-v3', debtAmount)` (5 bps of the principal).
   */
  readonly debtFlashloanFee: `${bigint}`;
}

/**
 * Atomically provision an Aave V3 borrow position on Base and migrate it to
 * a Morpho Blue WETH/USDC market — all in a single compose flow driven by
 * two concurrent flashloans.
 *
 * Phase 1 — provision the source position on Aave V3:
 * - User direct-deposits WETH.
 * - `lifi.zap` supplies the WETH to Aave (WETH → aBasWETH routing edge).
 * - `aave.borrow` mints USDC debt; the borrowed USDC stays on the proxy
 *   and is swept back to the signer as the user's loan proceeds.
 *
 * Phase 2 — migrate the position to Morpho using two concurrent flashloans:
 * - Flashloan #1 (Aave V3, USDC) bridges the Aave debt payoff before the
 *   Morpho borrow exists.
 * - Flashloan #2 (Balancer V2, WETH) bridges the Morpho collateral supply
 *   before the Aave collateral is freed.
 * - `aave.repay` clears the Aave USDC debt with flashloan #1.
 * - `lifi.zap` withdraws the freed WETH from Aave (aBasWETH → WETH).
 * - `morphoBlue.supplyCollateral` deposits flashloan #2's WETH into Morpho.
 * - `morphoBlue.borrow` mints exactly `debtAmount + debtFlashloanFee` USDC
 *   so the `borrowed` resource settles flashloan #1 with zero residual.
 * - Two `lifi.flashloanRepay` ops settle each leg: the USDC leg from the
 *   Morpho borrow, the WETH leg from the Aave withdrawal (Balancer V2
 *   charges no fee, so the principal alone covers it).
 *
 * After execution the signer holds `debtAmount` USDC and an open Morpho
 * Blue position (`collateralAmount` WETH collateral, `debtAmount +
 * debtFlashloanFee` USDC debt). The Aave position is closed.
 */
export const buildAaveToMorphoDebtMigration = ({
  owner,
  collateralAmount,
  debtAmount,
  debtFlashloanFee,
}: AaveToMorphoDebtMigrationInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // Both flashloan legs absorb Aave's 1-wei scaled-balance skew: the USDC
  // leg funds a max-mode repay, the WETH leg is covered by a withdrawal.
  const debtFlashloanAmount = padForAaveDebtRounding(debtAmount);
  const collateralFlashloanAmount =
    trimForAaveWithdrawalRounding(collateralAmount);

  // Morpho borrow must equal principal + Aave-V3 flashloan fee so the
  // `borrowed` resource exactly settles the USDC flashloan leg.
  const morphoBorrowAmount = (
    BigInt(debtFlashloanAmount) + BigInt(debtFlashloanFee)
  ).toString() as `${bigint}`;

  const builder = sdk.flow(8453, {
    name: 'aave-to-morpho-debt-migration',
    inputs: {
      initialCollateral: resources.erc20(BASE_WETH, 8453),
      debtFlashloan: resources.erc20(BASE_USDC, 8453),
      collateralFlashloan: resources.erc20(BASE_WETH, 8453),
    },
  });

  // --- Phase 1: provision the Aave V3 borrow position ----------------------

  // WETH → aBasWETH via the aave routing edge family (Aave V3 supply).
  const supplyToAave = builder.lifi.zap('supply-to-aave', {
    bind: { amountIn: builder.inputs.initialCollateral },
    config: { resourceOut: resources.erc20(A_BAS_WETH, 8453) },
  });

  // Borrow USDC against the freshly supplied collateral. The `borrowed`
  // resource is left unbound; request-level `sweepTo` forwards it to the
  // signer as the user's loan proceeds.
  builder.aave.borrow('borrow-from-aave', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL_BASE,
      asset: BASE_USDC,
      variableDebtToken: VDEBT_BAS_USDC,
      amount: debtAmount,
    },
  });

  // --- Phase 2: migrate to Morpho with two concurrent flashloans -----------

  // Settle the Aave USDC debt with flashloan #1. mode: 'max' makes Aave's
  // Pool clamp paybackAmount to userVariableDebt exactly, so any unspent
  // flashloan principal flows through the op's residual port (swept by the
  // request-level sweepTo).
  builder.aave.repay('repay-aave', {
    bind: {
      assetIn: builder.inputs.debtFlashloan,
      onBehalfOf: builder.context.executionAddress,
    },
    config: { pool: AAVE_V3_POOL_BASE, mode: 'max' },
  });

  // Withdraw the freed WETH from Aave (aBasWETH → WETH) via routing.
  const withdrawFromAave = builder.lifi.zap('withdraw-from-aave', {
    bind: { amountIn: supplyToAave.amountOut },
    config: { resourceOut: resources.erc20(BASE_WETH, 8453) },
  });

  // Open the Morpho Blue position with flashloan #2's WETH.
  builder.morphoBlue.supplyCollateral('supply-to-morpho', {
    bind: { assetIn: builder.inputs.collateralFlashloan },
    config: { marketParams: MORPHO_WETH_USDC_MARKET, mode: 'exact' },
  });

  // Borrow exactly principal + fee from Morpho to settle the USDC leg.
  const morphoBorrow = builder.morphoBlue.borrow('borrow-from-morpho', {
    bind: {},
    config: {
      marketParams: MORPHO_WETH_USDC_MARKET,
      amount: morphoBorrowAmount,
    },
  });

  // Settle the USDC flashloan leg with the Morpho borrow.
  builder.lifi.flashloanRepay('repay-debt-flashloan', {
    bind: { funds: morphoBorrow.borrowed },
    config: { leg: 'debtFlashloan' },
  });

  // Settle the WETH flashloan leg with the Aave withdrawal. Balancer V2
  // charges no fee, so the withdrawn principal alone covers the leg.
  builder.lifi.flashloanRepay('repay-collateral-flashloan', {
    bind: { funds: withdrawFromAave.amountOut },
    config: { leg: 'collateralFlashloan' },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      initialCollateral: materialisers.directDeposit({
        amount: collateralAmount,
      }),
      debtFlashloan: materialisers.flashloan({
        providerKind: 'aave-v3',
        amount: debtFlashloanAmount,
      }),
      collateralFlashloan: materialisers.flashloan({
        providerKind: 'balancer-v2',
        amount: collateralFlashloanAmount,
      }),
    },
    // Sweep the Aave borrow proceeds (and any aave.repay residual) to the
    // signer.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
