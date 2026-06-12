import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  createComposeSdk,
  guards,
  materialisers,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { BASE_URL } from '../config.js';

// Aave v3 contracts on Ethereum mainnet.
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave v3 aEthUSDC receipt token and variable-debt USDC token.
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';
const VDEBT_USDC = '0x72E95b8931767C79bA4EeE721354d6E99a61D004';

// 1.05 WAD (1e18) — minimum acceptable Aave health factor after the borrow.
// The on-chain VM reverts the run if the post-borrow HF drops below this.
const MIN_HEALTH_FACTOR_WAD = '1050000000000000000';

export interface AaveBorrowInput {
  readonly owner: Address;
  readonly recipient: Address;
  /** USDC supplied as collateral so the proxy can borrow (6 dp). */
  readonly collateralAmount: `${bigint}`;
  /** USDC borrowed against the collateral and sent to the recipient (6 dp). */
  readonly borrowAmount: `${bigint}`;
}

/**
 * Supply USDC to Aave v3, borrow USDC against it, and transfer the borrowed
 * funds to a recipient — with an on-chain health-factor guard that reverts
 * if the post-borrow position is too thin.
 *
 * The in-flow supply makes the example self-contained: the borrow is backed
 * by collateral created in the same transaction, so it simulates cleanly
 * for a fresh proxy. Keep `borrowAmount` comfortably below the collateral's
 * borrowing power or the health-factor guard reverts the run.
 *
 * Demonstrates:
 * - `lifi.zap` to supply USDC into Aave (USDC → aEthUSDC routing edge)
 * - `aave.borrow` with no resource input — the borrowed asset materialises
 *   as the `borrowed` resource output.
 * - Chaining the borrow output into a `core.transfer` to forward funds.
 * - `aave.getHealthFactor` + `core.numericInvariant` guard asserts that
 *   `healthFactor >= MIN_HEALTH_FACTOR_WAD` after the borrow; the run reverts
 *   on-chain if the threshold is violated.
 *
 * The supplied aEthUSDC stays on the proxy: it backs the open debt, and
 * Aave rejects aToken transfers that would break the position's health
 * factor, so it cannot be swept while the borrow is outstanding.
 */
export const buildAaveBorrow = ({
  owner,
  recipient,
  collateralAmount,
  borrowAmount,
}: AaveBorrowInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'aave-borrow-usdc',
    inputs: {
      collateralIn: resources.erc20(USDC, 1),
      recipient: 'address',
    },
  });

  // Supply USDC as collateral (USDC → aEthUSDC) so the proxy can borrow.
  builder.lifi.zap('supply', {
    bind: { amountIn: builder.inputs.collateralIn },
    config: { resourceOut: resources.erc20(A_ETH_USDC, 1) },
  });

  const borrowOut = builder.aave.borrow('borrow', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL,
      asset: USDC,
      variableDebtToken: VDEBT_USDC,
      amount: borrowAmount,
    },
  });

  // Read the post-borrow Aave health factor and assert it stays above the
  // minimum threshold. The numericInvariant guard lowers to an on-chain
  // `AssertRawInvariant` IR1 instruction; the run reverts if HF < threshold.
  builder.aave.getHealthFactor('hf', {
    bind: {},
    config: { pool: AAVE_V3_POOL },
    guards: [
      guards.coreNumericInvariant({
        port: 'healthFactor',
        op: 'gte',
        threshold: MIN_HEALTH_FACTOR_WAD,
      }),
    ],
  });

  // Forward the freshly borrowed USDC to the recipient.
  builder.core.transfer('send-borrowed', {
    bind: {
      amount: borrowOut.borrowed,
      recipient: builder.inputs.recipient,
    },
    config: {},
  });

  const flow = builder.build();

  // No sweepTo: the aEthUSDC collateral must stay on the proxy while the
  // debt is open — Aave blocks aToken transfers that would leave the
  // position undercollateralized.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      collateralIn: materialisers.directDeposit({ amount: collateralAmount }),
      recipient,
    },
  });

  return { flow, request };
};
