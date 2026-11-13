import {
  type ComposeCompileRequest,
  flashloanMaxFee,
  type Flow,
} from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import {
  padForAaveDebtRounding,
  trimForAaveWithdrawalRounding,
} from '../aaveRounding.js';
import { API_KEY, BASE_URL } from '../config.js';

// Base mainnet token addresses.
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Circle EURC on Base (6 decimals).
const BASE_EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

// Aave V3 on Base (pool + aWETH receipt + variable-debt USDC).
const AAVE_V3_POOL_BASE = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const A_BAS_WETH = '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7';
const VDEBT_BAS_USDC = '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28';

// Morpho Blue WETH/EURC market on Base. Real listed market — borrow APY
// ~1.02% at the time of writing vs ~5.30% on the WETH/USDC market, which is
// what makes this migration economically interesting. Market ID:
// 0xa9b5142fa687a24c275faf731f13b52faa9873252bb4e1cb6077aa1f412edb0b
// (= keccak256(MarketParams) of the values below).
const ADAPTIVE_CURVE_IRM_BASE = '0x46415998764C29aB2a25CbeA6254146D50D22687';
const WETH_EURC_ORACLE = '0xE1bb8E5b4930eC9FeC7f7943FCF6227649F14B37';
const WETH_EURC_LLTV = '860000000000000000';

const MORPHO_WETH_EURC_MARKET = {
  loanToken: BASE_EURC,
  collateralToken: BASE_WETH,
  oracle: WETH_EURC_ORACLE,
  irm: ADAPTIVE_CURVE_IRM_BASE,
  lltv: WETH_EURC_LLTV,
};

// Slippage budget on the EURC → USDC swap. The caller must size
// `morphoBorrowAmount` such that the swap's slippage-adjusted minimum covers
// the USDC leg's reserve: `debtAmount + maxFee`, where the Aave leg's default
// `maxFee` is `flashloanMaxFee` (5 bps, rounded up).
const SWAP_SLIPPAGE = 0.03;

export interface AaveToMorphoDebtMigrationWithSwapInput {
  readonly owner: Address;
  /** WETH collateral the user posts (in smallest units, 18 decimals). */
  readonly collateralAmount: `${bigint}`;
  /** USDC principal borrowed from Aave (6 decimals). */
  readonly debtAmount: `${bigint}`;
  /**
   * EURC to borrow from Morpho (6 decimals). Must be large enough that, after
   * the EURC → USDC swap at `SWAP_SLIPPAGE`, the swap's minimum output covers
   * `debtAmount + maxFee` (the USDC leg's reserve). Caller sizes this
   * off-chain from a live LI.FI quote, e.g.
   *   morphoBorrowAmount =
   *     ceil((debtAmount + maxFee) * eurcPerUsdc / (1 - slippage))
   * Note: EUR/USD is not 1:1 — the example fixture assumes ~1.075 USD/EUR.
   */
  readonly morphoBorrowAmount: `${bigint}`;
}

/**
 * Atomically migrate an Aave V3 USDC borrow on Base into the Morpho Blue
 * WETH/EURC market — same WETH collateral, different stablecoin debt. At the
 * time of writing Morpho's WETH/EURC borrow APY is ~1.02% vs ~5.30% on
 * USDC-denominated WETH-collateral markets, so a long-running borrow position
 * can be made materially cheaper by migrating the debt asset.
 *
 * Topology mirrors `aaveToMorphoDebtMigration`, with one extra step: after
 * Morpho mints EURC debt, the borrow proceeds are swapped to USDC via
 * `lifi.swap`, and the swap's `amountOut` (which carries the slippage-adjusted
 * minimum) settles the USDC flashloan leg.
 *
 * Phase 1 — provision the source position on Aave V3:
 * - User direct-deposits WETH.
 * - `lifi.zap` supplies the WETH to Aave (WETH → aBasWETH routing edge).
 * - `aave.borrow` mints USDC debt; the borrowed USDC stays on the proxy
 *   until the payout at the end of the flow.
 *
 * Phase 2 — migrate to Morpho using two concurrent flashloans:
 * - Flashloan #1 (Aave V3, USDC) bridges the Aave debt payoff before the
 *   Morpho borrow + swap exists.
 * - Flashloan #2 (Balancer V2, WETH) bridges the Morpho collateral supply
 *   before the Aave collateral is freed.
 * - `aave.repay` clears the Aave USDC debt with flashloan #1.
 * - `lifi.zap` withdraws the freed WETH from Aave (aBasWETH → WETH).
 * - `morphoBlue.supplyCollateral` deposits flashloan #2's WETH into Morpho.
 * - `morphoBlue.borrow` mints `morphoBorrowAmount` EURC.
 * - `lifi.swap` converts the borrowed EURC into USDC. `amountOut` carries the
 *   slippage-adjusted minimum that must cover the USDC leg's reserve.
 * - Two `lifi.flashloanRepay` ops earmark each leg's funds: the USDC leg's
 *   from the swap output, the WETH leg's from the Aave withdrawal (Balancer
 *   V2 charges no fee, so the withdrawn principal alone covers it). They move
 *   nothing: the funds stay in the proxy and the flashloan runtime repays both
 *   lenders after the program.
 * - The payout reads the proxy's USDC balance, splits the USDC leg's reserve
 *   off it with `core.splitAt`, and transfers the rest to the signer: the
 *   loan proceeds, the swap's USDC above the reserve, and the `mode: 'max'`
 *   repay's leftover.
 *
 * After execution the signer holds a Morpho Blue position with
 * `collateralAmount` WETH collateral and `morphoBorrowAmount` EURC debt; the
 * Aave position is closed. Dust stays on the proxy: the few wei of WETH the
 * withdrawal returns above the collateral leg, and any EURC the swap leaves
 * unsold (its `unspentIn`).
 */
export const buildAaveToMorphoDebtMigrationWithSwap = ({
  owner,
  collateralAmount,
  debtAmount,
  morphoBorrowAmount,
}: AaveToMorphoDebtMigrationWithSwapInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // Both flashloan legs absorb Aave's 2-wei scaled-balance skew: the USDC
  // leg funds a max-mode repay, the WETH leg is covered by a withdrawal.
  const debtFlashloanAmount = padForAaveDebtRounding(debtAmount);
  const collateralFlashloanAmount =
    trimForAaveWithdrawalRounding(collateralAmount);

  // The USDC leg's reserve: its principal plus the default fee cap. The
  // request states the same `maxFee` on the leg, so client and server agree
  // on the cap, and the payout splits exactly this reserve off.
  const maxFee = flashloanMaxFee({
    providerKind: 'aave-v3',
    amount: debtFlashloanAmount,
  });
  const debtReserve = (
    BigInt(debtFlashloanAmount) + maxFee
  ).toString() as `${bigint}`;

  const builder = sdk.flow(8453, {
    name: 'aave-to-morpho-debt-migration-with-swap',
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
  // resource is left unbound: it stays on the proxy as the user's loan
  // proceeds, and `payout-borrow-proceeds` forwards it to the signer.
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
  // flashloan principal stays on the proxy and reaches the payout below.
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
    config: { marketParams: MORPHO_WETH_EURC_MARKET, mode: 'exact' },
  });

  // Borrow EURC at the destination's (cheaper) APR.
  const morphoBorrow = builder.morphoBlue.borrow('borrow-from-morpho', {
    bind: {},
    config: {
      marketParams: MORPHO_WETH_EURC_MARKET,
      amount: morphoBorrowAmount,
    },
  });

  // Swap EURC → USDC so the borrow proceeds can settle the USDC flashloan
  // leg. `amountOut` carries `providesMinimum: true`; the caller is
  // responsible for sizing `morphoBorrowAmount` so the slippage-adjusted
  // minimum covers the leg's reserve, `debtAmount + maxFee`.
  const swapDebt = builder.lifi.swap('swap-borrow-to-usdc', {
    bind: { amountIn: morphoBorrow.borrowed },
    config: {
      resourceOut: resources.erc20(BASE_USDC, 8453),
      slippage: SWAP_SLIPPAGE,
    },
  });

  // Earmark the swap output for the USDC flashloan leg. The payout returns
  // whatever the proxy holds above the leg's reserve to the signer.
  builder.experimental.lifi.flashloanRepay('repay-debt-flashloan', {
    bind: { funds: swapDebt.amountOut },
  });

  // Earmark the Aave withdrawal for the WETH flashloan leg. Balancer V2
  // charges no fee, so the withdrawn principal alone covers the leg.
  builder.experimental.lifi.flashloanRepay('repay-collateral-flashloan', {
    bind: { funds: withdrawFromAave.amountOut },
  });

  // Forward the USDC above the leg's reserve to the signer. The proxy's live
  // USDC balance holds the loan proceeds, the swap output and the repay's
  // leftover; the reserve must stay in the proxy for the runtime to repay
  // Aave. The split keeps `min(balance, reserve)` as its head and pays out
  // only the tail.
  //
  // A request-level `sweepTo` cannot do this: `outputs` reports the unbound
  // `borrowed` and `residual` ports in full, but the sweep withholds the
  // reserve, so it moves less than they report and compose rejects the flow.
  const usdcBalance = builder.core.balanceOf('read-usdc-balance', {
    bind: {},
    config: { token: BASE_USDC },
  });
  const { tail: usdcProceeds } = builder.core.splitAt(
    'exclude-flashloan-reserve',
    {
      bind: { source: usdcBalance.balance },
      config: { amount: debtReserve },
    },
  );
  builder.core.transfer('payout-borrow-proceeds', {
    bind: {
      amount: usdcProceeds,
      recipient: builder.context.sender,
    },
    config: {},
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      initialCollateral: materialisers.directDeposit({
        amount: collateralAmount,
      }),
      debtFlashloan: materialisers.experimental.flashloan({
        providerKind: 'aave-v3',
        amount: debtFlashloanAmount,
        maxFee,
      }),
      collateralFlashloan: materialisers.experimental.flashloan({
        providerKind: 'balancer-v2',
        amount: collateralFlashloanAmount,
      }),
    },
  });

  return { flow, request };
};
