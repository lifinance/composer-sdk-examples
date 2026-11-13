import {
  type ComposeCompileRequest,
  flashloanMaxFee,
  type Flow,
} from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { API_KEY, BASE_URL } from '../config.js';

// Base mainnet token addresses.
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Circle EURC on Base (6 decimals).
const BASE_EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

// Token decimals for the Paraswap BUY (raw-address requests require them).
const EURC_DECIMALS = 6;
const USDC_DECIMALS = 6;

// Aave V3 on Base: pool + WETH aToken + variable-debt tokens for the old (USDC)
// and new (EURC) debt assets. The variable-debt token only feeds aave.borrow
// (to read the post-borrow debt balance); aave.repay infers the asset from its
// bound input resource. Verified live against Pool.getReserveData on Base.
const AAVE_V3_POOL_BASE = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const A_BAS_WETH = '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7';
const VDEBT_BAS_USDC = '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28';
const VDEBT_BAS_EURC = '0x03D01595769333174036832e18fA2f17C74f8161';

// Source-cap slippage on the EURC → USDC BUY, in basis points. This bounds how
// much extra EURC Augustus may pull above the quoted source before refunding.
// `newDebtBorrowAmount` must exceed the resulting `maxAmountIn`.
const DEFAULT_MAX_SLIPPAGE_BPS = 100; // 1%

export interface AaveDebtRebalanceExactOutInput {
  readonly owner: Address;
  /**
   * WETH collateral used to seed the position (in smallest units, 18 decimals).
   * In production the position already exists and this seed step is omitted —
   * the collateral is never touched by the rebalance itself.
   */
  readonly collateralAmount: `${bigint}`;
  /**
   * Outstanding USDC debt to rebalance away from (6 decimals). The flashloan is
   * sized to this; in production size it just above the live debt so the capped
   * repay clears it after accrued interest.
   */
  readonly debtAmount: `${bigint}`;
  /**
   * EURC to borrow as the *new* debt (6 decimals). Sized as a *generous upper
   * bound* — large enough that the exact-output BUY can always produce
   * `debtAmount + maxFee` USDC even after `maxSlippageBps` of source slippage
   * (i.e. `newDebtBorrowAmount > maxAmountIn`). The BUY pulls only what it needs;
   * the unspent EURC is repaid straight back into the freshly-minted EURC debt,
   * so the *net* new debt is the original USDC debt (in EURC terms) plus only
   * the slippage/fee actually consumed — NOT the full upper bound.
   * Note: EUR/USD is not 1:1 — size off a live BUY quote, e.g.
   *   newDebtBorrowAmount ≈ ceil((debtAmount + maxFee) * eurcPerUsdc * (1 + slippage))
   */
  readonly newDebtBorrowAmount: `${bigint}`;
  /** Optional source-cap slippage on the BUY, in bps (default 100 = 1%). */
  readonly maxSlippageBps?: number;
  /** Optional integrator label for analytics / fee capture. */
  readonly partner?: string;
  /** Optional fee recipient; required to actually receive a partner fee. */
  readonly partnerAddress?: Address;
  /** Optional fixed partner fee in bps (e.g. '50' = 0.5%); needs partnerAddress. */
  readonly partnerFeeBps?: string;
}

/**
 * Atomically **rebalance** (debt-swap) an Aave V3 position on Base from USDC
 * debt into EURC debt — same protocol, same WETH collateral, only the debt
 * *token* changes — using a native **exact-output** (Paraswap/Velora BUY) swap.
 *
 * This is the single-protocol "debt switch" pattern productised by Aave's
 * `ParaSwapDebtSwapAdapter` and DeFi Saver's "Debt Switch": flashloan/borrow the
 * new debt slightly over a cap, exact-out-swap to produce exactly the old debt
 * owed, repay the old debt, then repay the leftover new asset back into the
 * freshly-created new debt so lasting debt = only what was consumed. Contrast
 * with `aaveToMorphoDebtMigrationWithSwapExactOut.ts`, which *migrates* the whole
 * position across protocols (Aave → Morpho) and therefore needs a second
 * flashloan to move the collateral; here the collateral never moves, so a single
 * flashloan of the old debt token suffices.
 *
 * Why rebalance USDC → EURC: at the time of writing EURC's Base Aave V3 variable
 * borrow APR (~3.87%) sits below USDC's (~4.28%), and a EUR-based borrower may
 * also want the liability denominated in EUR to match income/assets (removing
 * USD/EUR FX risk on the debt). The reward is the APR delta over the holding
 * period; the cost is the Aave flashloan premium (5 bps) plus the realised
 * swap slippage on the consumed notional only.
 *
 * Phase 1 — provision the starting position on Aave V3 (illustrative; omit in
 * production where the position already exists):
 * - User direct-deposits WETH.
 * - `lifi.zap` supplies the WETH to Aave (WETH → aBasWETH routing edge).
 * - `aave.borrow` mints the USDC debt being rebalanced; the borrowed USDC is
 *   swept back to the signer as the user's existing loan proceeds.
 *
 * Phase 2 — rebalance USDC debt → EURC debt with one flashloan:
 * - Flashloan (Aave V3, USDC) bridges the old-debt payoff before the new debt
 *   exists.
 * - `aave.repay(mode: 'max')` clears the USDC debt with the flashloan; Aave's
 *   Pool clamps to the outstanding debt exactly, any cap residual is swept.
 * - `aave.borrow` mints a *capped* (generously over-sized) `newDebtBorrowAmount`
 *   of EURC against the same, still-supplied WETH collateral.
 * - `paraswap.buy` buys *exactly* `debtAmount + maxFee` USDC with the borrowed
 *   EURC, pulling only the EURC needed. `amountOut` is the leg's reserve: the
 *   principal plus the fee cap the flight allows Aave to charge; `unspentIn` is
 *   every borrowed EURC the swap did not sell, including the headroom above the
 *   swap cap.
 * - `lifi.flashloanRepay` earmarks `buy.amountOut` for the USDC leg
 *   (`amountOut` is the whole reserve). It moves nothing: the USDC stays in
 *   the proxy, and the flashloan runtime repays Aave after the program.
 * - `aave.repay(mode: 'exact')` repays the proxy's live EURC balance (the same
 *   EURC `buy.unspentIn` names) straight back into the freshly-minted EURC
 *   debt, unwinding the borrow buffer. Any genuine over-repay surfaces through
 *   the repay op's `residual`, swept to the signer.
 * - `core.transfer` pays the USDC loan proceeds to the signer: the live USDC
 *   balance minus the reserve the runtime repays Aave from.
 *
 * After execution the signer holds the same WETH collateral on Aave V3 with EURC
 * debt equal to the original USDC debt (in EUR terms) plus only the consumed
 * slippage/fee; the USDC debt is closed.
 */
export const buildAaveDebtRebalanceExactOut = ({
  owner,
  collateralAmount,
  debtAmount,
  newDebtBorrowAmount,
  maxSlippageBps = DEFAULT_MAX_SLIPPAGE_BPS,
  // The rest is the optional partner-fee fields. Spreading them forwards only
  // the fields the caller set, so no fee policy is baked in by default.
  ...partnerFee
}: AaveDebtRebalanceExactOutInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // The USDC the BUY must produce: the flashloan principal plus the leg's
  // `maxFee`, the default fee cap (5 bps of the principal, rounded up, since
  // Aave rounds its premium half-up). This is the leg's reserve: the proxy
  // keeps it through the program and the runtime repays Aave from it. The
  // request states the same `maxFee` on the leg, so client and server agree
  // on the cap.
  const maxFee = flashloanMaxFee({
    providerKind: 'aave-v3',
    amount: debtAmount,
  });
  const exactUsdcOut = (BigInt(debtAmount) + maxFee).toString() as `${bigint}`;

  const builder = sdk.flow(8453, {
    name: 'aave-debt-rebalance-usdc-to-eurc-exact-out',
    inputs: {
      initialCollateral: resources.erc20(BASE_WETH, 8453),
      // Single flashloan: the old (USDC) debt token. No collateral flashloan is
      // needed because the WETH collateral never leaves Aave.
      debtFlashloan: resources.erc20(BASE_USDC, 8453),
    },
  });

  // --- Phase 1: provision the starting Aave V3 USDC borrow -----------------

  // WETH → aBasWETH via the aave routing edge family (Aave V3 supply). The
  // supplied collateral is never withdrawn — it backs the new EURC debt — so
  // the aBasWETH output is intentionally left unconsumed AND unswept: it is the
  // user's resulting collateral position and must stay on the (persistent,
  // per-user) proxy. This is why the flow does NOT set a blanket `sweepTo`
  // (which would try to transfer the aToken out and revert, since collateral
  // backing an open debt cannot be moved); instead we explicitly transfer only
  // the genuinely-loose tokens below.
  builder.lifi.zap('supply-collateral', {
    bind: { amountIn: builder.inputs.initialCollateral },
    config: { resourceOut: resources.erc20(A_BAS_WETH, 8453) },
  });

  // Borrow the USDC debt being rebalanced. The proceeds are the user's loan;
  // they remain as the proxy's residual USDC and are forwarded to the signer at
  // the end of the flow (see `payout-borrow-proceeds`).
  builder.aave.borrow('borrow-usdc-debt', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL_BASE,
      asset: BASE_USDC,
      variableDebtToken: VDEBT_BAS_USDC,
      amount: debtAmount,
    },
  });

  // --- Phase 2: rebalance USDC debt → EURC debt ----------------------------

  // Settle the USDC debt with the flashloan. mode: 'max' makes Aave's Pool
  // clamp paybackAmount to the outstanding debt exactly; unspent flashloan
  // principal flows through the op's residual port (swept).
  builder.aave.repay('repay-usdc-debt', {
    bind: {
      assetIn: builder.inputs.debtFlashloan,
      onBehalfOf: builder.context.executionAddress,
    },
    config: { pool: AAVE_V3_POOL_BASE, mode: 'max' },
  });

  // Borrow a capped (generously over-sized) EURC amount against the same WETH
  // collateral, now that the USDC debt is cleared. The over-borrow is
  // intentional and is unwound below.
  const borrowEurc = builder.aave.borrow('borrow-eurc-debt', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL_BASE,
      asset: BASE_EURC,
      variableDebtToken: VDEBT_BAS_EURC,
      amount: newDebtBorrowAmount,
    },
  });

  // Exact-output BUY: produce EXACTLY `exactUsdcOut` USDC from the borrowed
  // EURC, pulling only the EURC needed and refunding the rest to the proxy
  // (surfaced as `unspentIn`). `amountOut` is the USDC leg's whole reserve.
  const buyUsdc = builder.paraswap.buy('buy-usdc-exact', {
    bind: { amountIn: borrowEurc.borrowed },
    config: {
      resourceOut: resources.erc20(BASE_USDC, 8453),
      exactAmountOut: exactUsdcOut,
      srcDecimals: EURC_DECIMALS,
      destDecimals: USDC_DECIMALS,
      maxSlippageBps,
      ...partnerFee,
    },
  });

  // Earmark the exact BUY output for the USDC flashloan leg. One repay node:
  // `amountOut` is the leg's whole reserve. The op moves nothing; the runtime
  // repays Aave from the proxy after the program.
  builder.experimental.lifi.flashloanRepay('repay-debt-flashloan', {
    bind: { funds: buyUsdc.amountOut },
  });

  // Unwind the over-borrow: repay the proxy's FULL residual EURC back into the
  // freshly-minted EURC debt, so the new debt equals exactly the EURC the swap
  // consumed. The live EURC balance equals `buy.unspentIn` (borrow − sold):
  // Augustus's refund below the cap plus the headroom we over-borrowed above it
  // (borrow − cap), which Augustus never pulled. Repaying it leaves zero idle.
  // mode: 'exact' pulls precisely this balance (Aave clamps to min(balance,
  // debt)); mode: 'max' would pass type(uint256).max and try to pull the whole
  // outstanding debt, far exceeding the residual on the proxy, and revert.
  const eurcResidual = builder.core.balanceOf('read-eurc-residual', {
    bind: {},
    config: { token: BASE_EURC },
  });
  builder.aave.repay('repay-eurc-remainder', {
    bind: {
      assetIn: eurcResidual.balance,
      onBehalfOf: builder.context.executionAddress,
    },
    config: { pool: AAVE_V3_POOL_BASE, mode: 'exact' },
  });

  // Forward the genuinely-loose USDC — the loan proceeds — to the signer. We
  // read the proxy's LIVE USDC balance rather than the fixed borrowed amount:
  // Aave's `mode: 'max'` USDC-debt repay overshoots the borrow by up to 2 wei
  // (ray-math round-trip), so the proxy ends up to 2 wei short of `borrowed` —
  // transferring a fixed amount would revert "transfer amount exceeds balance".
  // The live balance also holds the flashloan reserve (`exactUsdcOut`), which
  // must stay in the proxy for the runtime to repay Aave, so the split keeps
  // `min(balance, reserve)` as its head and pays out only the tail. Paying out
  // the whole balance would leave the proxy short at settlement: the flight's
  // settlement reverts `FlashloanRepaymentShort`, which compose reports as a
  // 400 `validation_error` with a `shortfall`.
  //
  // We deliberately do NOT use a blanket `sweepTo`: the only other proxy-held
  // balance is the aBasWETH collateral position, which cannot be transferred
  // while the EURC debt is open (Aave's finalizeTransfer reverts). The position
  // therefore stays on the persistent per-user proxy; we move out only the USDC.
  const usdcResidual = builder.core.balanceOf('read-usdc-residual', {
    bind: {},
    config: { token: BASE_USDC },
  });
  const { tail: usdcProceeds } = builder.core.splitAt(
    'exclude-flashloan-reserve',
    {
      bind: { source: usdcResidual.balance },
      config: { amount: exactUsdcOut },
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
        amount: debtAmount,
        maxFee,
      }),
    },
    // No blanket `sweepTo`: the resulting aBasWETH collateral position stays on
    // the proxy (it backs the open EURC debt and cannot be moved). The loose
    // USDC proceeds are forwarded via the explicit `payout-borrow-proceeds`
    // transfer above.
  });

  return { flow, request };
};
