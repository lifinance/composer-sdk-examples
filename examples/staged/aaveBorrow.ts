import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, guards } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { BASE_URL } from '../config.js';

// Aave v3 contracts on Ethereum mainnet.
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const VDEBT_USDC = '0x72E95b8931767C79bA4EeE721354d6E99a61D004';

// 1.05 WAD (1e18) — minimum acceptable Aave health factor after the borrow.
// The on-chain VM reverts the run if the post-borrow HF drops below this.
const MIN_HEALTH_FACTOR_WAD = '1050000000000000000';

export interface AaveBorrowInput {
  readonly owner: Address;
  readonly recipient: Address;
  readonly amount: `${bigint}`;
}

/**
 * Borrow USDC against existing Aave v3 collateral and transfer it to a recipient,
 * with an on-chain health-factor guard that reverts if the post-borrow position
 * is too thin.
 *
 * The proxy address must already hold supplied collateral. The borrow op
 * exposes the borrowed amount as a tracked resource so downstream nodes can
 * spend it.
 *
 * Demonstrates:
 * - `aave.borrow` with no resource input — the borrowed asset materialises
 *   as the `borrowed` resource output.
 * - Chaining the borrow output into a `core.transfer` to forward funds.
 * - The `debtBalance` handle reports the post-borrow variable-debt balance
 *   for the proxy.
 * - `aave.getHealthFactor` + `core.numericInvariant` guard asserts that
 *   `healthFactor >= MIN_HEALTH_FACTOR_WAD` after the borrow; the run reverts
 *   on-chain if the threshold is violated.
 */
export const buildAaveBorrow = ({
  owner,
  recipient,
  amount,
}: AaveBorrowInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // The flow takes no resource inputs — Aave hands us the borrowed asset.
  const builder = sdk.flow(1, {
    name: 'aave-borrow-usdc',
    inputs: {
      recipient: 'address',
    },
  });

  const borrowOut = builder.aave.borrow('borrow', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL,
      asset: USDC,
      variableDebtToken: VDEBT_USDC,
      amount,
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

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      recipient,
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
