/**
 * Helpers for Aave v3's scaled-balance rounding.
 *
 * Aave v3 does not store balances directly. Every aToken / variable-debt
 * balance is kept as scaled shares and converted on each access using the
 * market's live index (RAY = 1e27 precision):
 *
 * - write:  shares = amount.rayDiv(index)   — round half-up to 1 ray-wei
 * - read:   balance = shares.rayMul(index)  — round half-up to 1 wei
 *
 * The write+read round trip therefore drifts by up to ~index/RAY wei in
 * either direction — about 1 wei while the index is below ~2e27, which
 * holds for all current Aave v3 markets. Concretely, in the same block:
 *
 * - a debt opened with `borrow(x)` can read back as `x + 1` wei, and
 * - collateral supplied with `supply(x)` can read back as `x - 1` wei.
 *
 * The drift direction depends on how the amount aligns with the index
 * remainder, and the index accrues every block — so a simulation that
 * passes with exact amounts at block N can still revert on-chain at block
 * N+k. Any flow that settles an exact amount against a same-block Aave
 * readback (flashloan legs, exact transfers) must budget the worst case:
 *
 * - `padForAaveDebtRounding` — for amounts that must *cover* a same-block
 *   debt readback, e.g. a flashloan principal funding a max-mode repay.
 * - `trimForAaveWithdrawalRounding` — for amounts that must be *covered
 *   by* a same-block balance readback, e.g. a flashloan leg repaid from
 *   an Aave withdrawal.
 *
 * The over- or under-shoot wei surface as residual/dust and are swept.
 */

/** Worst-case same-block readback drift for indices below ~2e27. */
export const AAVE_SAME_BLOCK_SKEW_WEI = 1n;

export const padForAaveDebtRounding = (amount: `${bigint}`): `${bigint}` =>
  (BigInt(amount) + AAVE_SAME_BLOCK_SKEW_WEI).toString() as `${bigint}`;

export const trimForAaveWithdrawalRounding = (
  amount: `${bigint}`,
): `${bigint}` =>
  (BigInt(amount) - AAVE_SAME_BLOCK_SKEW_WEI).toString() as `${bigint}`;
