/**
 * Helpers for Aave v3's scaled-balance rounding.
 *
 * Aave v3 does not store balances directly. Every aToken / variable-debt
 * balance is kept as scaled shares and converted on each access using the
 * market's live index (RAY = 1e27 precision). Since Aave v3.5 each step
 * rounds in the protocol's favour:
 *
 * - supply: shares = floor(amount / index), read back with floor
 * - borrow: shares = ceil(amount / index), read back with ceil
 *
 * The write+read round trip therefore drifts by less than index/RAY + 1
 * wei: up to 2 wei while the index is below 2e27, which holds for all
 * current Aave v3 markets. Concretely, in the same block:
 *
 * - a debt opened with `borrow(x)` can read back as up to `x + 2` wei, and
 * - collateral supplied with `supply(x)` can read back as `x - 2` wei.
 *
 * The drift depends on how the amount aligns with the index remainder, and
 * the index accrues every block, so a simulation that passes with exact
 * amounts at block N can still revert on-chain at block N+k. Any flow that
 * settles an exact amount against a same-block Aave readback (flashloan
 * legs, exact transfers) must budget the worst case:
 *
 * - `padForAaveDebtRounding`: for amounts that must *cover* a same-block
 *   debt readback, e.g. a flashloan principal funding a max-mode repay.
 * - `trimForAaveWithdrawalRounding`: for amounts that must be *covered
 *   by* a same-block balance readback, e.g. a flashloan leg repaid from
 *   an Aave withdrawal.
 *
 * The over- or under-shoot wei surface as residual/dust.
 */

/** Worst-case same-block readback drift for indices below 2e27. */
export const AAVE_SAME_BLOCK_SKEW_WEI = 2n;

export const padForAaveDebtRounding = (amount: `${bigint}`): `${bigint}` =>
  (BigInt(amount) + AAVE_SAME_BLOCK_SKEW_WEI).toString() as `${bigint}`;

export const trimForAaveWithdrawalRounding = (
  amount: `${bigint}`,
): `${bigint}` =>
  (BigInt(amount) - AAVE_SAME_BLOCK_SKEW_WEI).toString() as `${bigint}`;
