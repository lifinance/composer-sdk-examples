import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { BASE_URL } from '../config.js';

// Base mainnet token addresses.
const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Circle EURC on Base (6 decimals).
const BASE_EURC = '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42';

// Token decimals for the Paraswap BUY (raw-address requests require them).
const EURC_DECIMALS = 6;
const USDC_DECIMALS = 6;

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

// Aave V3 flashloan premium (FLASHLOAN_PREMIUM_TOTAL) = 5 bps of principal.
// Mirrors the builtins package's `computeDefaultFee('aave-v3', amount)`,
// inlined so the example stays free of compose-internals imports (the SDK must
// not cross the manifest boundary into the builtins package). Override if the
// pool's premium has changed on-chain.
const AAVE_V3_FEE_BPS = 5n;
const BPS_DENOMINATOR = 10_000n;
const computeAaveV3Fee = (principal: bigint): bigint =>
  (principal * AAVE_V3_FEE_BPS) / BPS_DENOMINATOR;

// Aave's aToken round-trips through ray math: withdrawing freshly-supplied
// collateral returns up to 1 wei LESS than supplied. The Balancer V2 collateral
// flashloan, however, must be repaid to the exact wei of its principal. To keep
// the flashloan (and the migrated Morpho collateral) at the full
// `collateralAmount`, we supply a few extra wei to Aave so the withdrawal always
// covers the repay. The tiny remainder is swept back to the signer.
const AAVE_WITHDRAW_ROUNDING_BUFFER = 2n;

// Source-cap slippage on the EURC → USDC BUY, in basis points. This bounds how
// much extra EURC Augustus may pull above the quoted source before refunding.
// `morphoBorrowAmount` must exceed the resulting `maxAmountIn`.
const DEFAULT_MAX_SLIPPAGE_BPS = 100; // 1%

export interface AaveToMorphoDebtMigrationWithSwapExactOutInput {
  readonly owner: Address;
  /** WETH collateral the user posts (in smallest units, 18 decimals). */
  readonly collateralAmount: `${bigint}`;
  /** USDC principal borrowed from Aave (6 decimals). */
  readonly debtAmount: `${bigint}`;
  /**
   * EURC to borrow from Morpho (6 decimals). Sized as a *generous upper bound*
   * — large enough that the exact-output BUY can always produce
   * `debtAmount + aaveV3Fee` USDC even after `maxSlippageBps` of source slippage
   * (i.e. `morphoBorrowAmount > maxAmountIn`). The BUY pulls only what it needs;
   * the unspent EURC is repaid straight back into the freshly-minted Morpho
   * debt, so the *net* migrated debt is the original Aave debt (in EURC terms)
   * plus only the slippage/fee actually consumed — NOT the full upper bound.
   * Note: EUR/USD is not 1:1 — size off a live BUY quote, e.g.
   *   morphoBorrowAmount ≈ ceil((debtAmount + aaveV3Fee) * eurcPerUsdc * (1 + slippage))
   */
  readonly morphoBorrowAmount: `${bigint}`;
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
 * Atomically migrate an Aave V3 USDC borrow on Base into the Morpho Blue
 * WETH/EURC market — same WETH collateral, different stablecoin debt — using a
 * native **exact-output** (Paraswap/Velora BUY) swap instead of the exact-input
 * `lifi.swap`.
 *
 * Contrast with `aaveToMorphoDebtMigrationWithSwap.ts` (the exact-input
 * variant): there the author must over-size the Morpho borrow so a slippage-
 * adjusted *minimum* output still clears the fixed flashloan need, and the
 * buffer lands on the borrow leg as lasting debt. Here `paraswap.buy` produces
 * *exactly* `debtAmount + aaveV3Fee` USDC, pulls only the EURC it needs, and the
 * genuinely-unspent EURC is refunded to the proxy and surfaced as `unspentIn` —
 * which we route straight into a capped `morphoBlue.repay` to unwind the
 * over-borrow. Net migrated debt = original debt + only the consumed
 * slippage/fee, not a standing buffer.
 *
 * Phase 1 — provision the source position on Aave V3:
 * - User direct-deposits WETH.
 * - `lifi.zap` supplies the WETH to Aave (WETH → aBasWETH routing edge).
 * - `aave.borrow` mints USDC debt; the borrowed USDC is swept back to the
 *   signer as the user's loan proceeds.
 *
 * Phase 2 — migrate to Morpho using two concurrent flashloans:
 * - Flashloan #1 (Aave V3, USDC) bridges the Aave debt payoff.
 * - Flashloan #2 (Balancer V2, WETH) bridges the Morpho collateral supply.
 * - `aave.repay(mode: 'max')` clears the Aave USDC debt with flashloan #1.
 * - `lifi.zap` withdraws the freed WETH from Aave (aBasWETH → WETH).
 * - `morphoBlue.supplyCollateral` deposits flashloan #2's WETH into Morpho.
 * - `morphoBlue.borrow` mints a *capped* `morphoBorrowAmount` of EURC.
 * - `paraswap.buy` buys *exactly* `debtAmount + aaveV3Fee` USDC with the
 *   borrowed EURC. `amountOut` is the exact figure that settles the USDC
 *   flashloan leg; `unspentIn` is the refunded, unspent EURC.
 * - `lifi.flashloanRepay` settles the USDC leg from `buy.amountOut` (no
 *   feeBuffer: `amountOut == principal + fee` by construction) and the WETH leg
 *   from the Aave withdrawal (Balancer V2 charges no fee).
 * - `morphoBlue.repay(mode: 'max')` repays the unspent EURC (`buy.unspentIn`)
 *   straight back into the freshly-minted Morpho debt, unwinding the borrow
 *   buffer. Any genuine over-repay surfaces through the repay op's `residual`,
 *   which `sweepTo` forwards to the signer.
 *
 * After execution the signer holds a Morpho Blue position with
 * `collateralAmount` WETH collateral and EURC debt equal to the original Aave
 * debt plus only the consumed slippage/fee; the Aave position is closed.
 */
export const buildAaveToMorphoDebtMigrationWithSwapExactOut = ({
  owner,
  collateralAmount,
  debtAmount,
  morphoBorrowAmount,
  maxSlippageBps = DEFAULT_MAX_SLIPPAGE_BPS,
  partner,
  partnerAddress,
  partnerFeeBps,
}: AaveToMorphoDebtMigrationWithSwapExactOutInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // The USDC the BUY must produce: the flashloan principal plus the Aave V3
  // flashloan premium. This is exactly what settles the debt flashloan leg.
  const exactUsdcOut = (
    BigInt(debtAmount) + computeAaveV3Fee(BigInt(debtAmount))
  ).toString() as `${bigint}`;

  const builder = sdk.flow(8453, {
    name: 'aave-to-morpho-debt-migration-with-swap-exact-out',
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

  // Settle the Aave USDC debt with flashloan #1. mode: 'max' makes Aave's Pool
  // clamp paybackAmount to the outstanding debt exactly; unspent flashloan
  // principal flows through the op's residual port (swept).
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

  // Borrow a capped (generously over-sized) EURC amount at the destination's
  // cheaper APR. The over-borrow is intentional and is unwound below.
  const morphoBorrow = builder.morphoBlue.borrow('borrow-from-morpho', {
    bind: {},
    config: {
      marketParams: MORPHO_WETH_EURC_MARKET,
      amount: morphoBorrowAmount,
    },
  });

  // Exact-output BUY: produce EXACTLY `exactUsdcOut` USDC from the borrowed
  // EURC, pulling only the EURC needed and refunding the rest to the proxy
  // (surfaced as `unspentIn`). `amountOut` is the exact figure that settles the
  // USDC flashloan leg.
  const buyUsdc = builder.paraswap.buy('buy-usdc-exact', {
    bind: { amountIn: morphoBorrow.borrowed },
    config: {
      resourceOut: resources.erc20(BASE_USDC, 8453),
      exactAmountOut: exactUsdcOut,
      srcDecimals: EURC_DECIMALS,
      destDecimals: USDC_DECIMALS,
      maxSlippageBps,
      ...(partner !== undefined ? { partner } : {}),
      ...(partnerAddress !== undefined ? { partnerAddress } : {}),
      ...(partnerFeeBps !== undefined ? { partnerFeeBps } : {}),
    },
  });

  // Settle the USDC flashloan leg with the exact BUY output. No feeBuffer:
  // `amountOut == principal + fee` by construction.
  builder.lifi.flashloanRepay('repay-debt-flashloan', {
    bind: { funds: buyUsdc.amountOut },
    config: { leg: 'debtFlashloan' },
  });

  // Settle the WETH flashloan leg with the Aave withdrawal. Balancer V2 charges
  // no fee, so the withdrawn principal alone covers the leg.
  builder.lifi.flashloanRepay('repay-collateral-flashloan', {
    bind: { funds: withdrawFromAave.amountOut },
    config: { leg: 'collateralFlashloan' },
  });

  // Unwind the over-borrow: repay the proxy's FULL residual EURC back into the
  // freshly-minted Morpho debt, so the migrated debt equals exactly the EURC the
  // swap consumed. We read the live EURC balance rather than binding
  // `buy.unspentIn`: unspentIn is only Augustus's refund (cap − used), but the
  // proxy ALSO still holds the headroom we over-borrowed above the swap cap
  // (morphoBorrowAmount − cap), which Augustus never pulled. The live balance
  // captures both, leaving zero idle EURC. mode: 'exact' pulls precisely this
  // balance; mode: 'max' would repay the FULL Morpho debt in shares mode
  // (reading Position.borrowShares) and pull far more EURC than the residual,
  // reverting with "transfer amount exceeds balance".
  const eurcResidual = builder.core.balanceOf('read-eurc-residual', {
    bind: {},
    config: { token: BASE_EURC },
  });
  builder.morphoBlue.repay('repay-morpho-remainder', {
    bind: {
      assetIn: eurcResidual.balance,
      onBehalfOf: builder.context.executionAddress,
    },
    config: { marketParams: MORPHO_WETH_EURC_MARKET, mode: 'exact' },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      // Supply a few extra wei over the flashloaned `collateralAmount` so the
      // Aave withdrawal (which rounds down by up to 1 wei) still fully covers
      // the exact-principal Balancer collateral-flashloan repayment.
      initialCollateral: materialisers.directDeposit({
        amount: (
          BigInt(collateralAmount) + AAVE_WITHDRAW_ROUNDING_BUFFER
        ).toString() as `${bigint}`,
      }),
      debtFlashloan: materialisers.flashloan({
        providerKind: 'aave-v3',
        amount: debtAmount,
      }),
      collateralFlashloan: materialisers.flashloan({
        providerKind: 'balancer-v2',
        amount: collateralAmount,
      }),
    },
    // Sweep Aave borrow proceeds, aave.repay's residual, and any EURC over-repay
    // residual from the capped Morpho repay back to the signer.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
