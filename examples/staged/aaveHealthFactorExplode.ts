import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, guards } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { BASE_URL } from '../config.js';

// Base mainnet Aave v3 Pool.
const AAVE_V3_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

// 1.0 WAD (1e18) — minimum acceptable health factor.
const MIN_HEALTH_FACTOR_WAD = '1000000000000000000';

export interface AaveHealthFactorExplodeInput {
  readonly signer: Address;
}

/**
 * EXPLODE / DecomposeValue showcase.
 *
 * NOTE: currently disabled end-to-end. `aave.getHealthFactor` is in the
 * default `DISABLED_COMPOSE_OPS` set on zap-backend because the EXPLODE
 * opcode is not yet supported on-chain. The example still builds a valid
 * Flow JSON (and its spec passes), but submitting the request to a backend
 * with default config will fail at op resolution. Re-enable by unsetting
 * `aave.getHealthFactor` in the backend's `DISABLED_COMPOSE_OPS` once
 * contracts ship EXPLODE.
 *
 * Builds a minimal compose flow that:
 * - StaticCalls `IPool.getUserAccountData(user)` on Aave v3 (Base)
 * - Decomposes the returned 6-tuple via the EXPLODE opcode
 * - Asserts `healthFactor >= 1.0 WAD` via `core.numericInvariant`
 *
 * The signer must hold an Aave v3 position on the target chain so HF > 0.
 * Uses `allow-revert` so the compiled calldata is returned even if the
 * assertion would fail — handy for tracing on a fork.
 */
export const buildAaveHealthFactorExplode = ({
  signer,
}: AaveHealthFactorExplodeInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(8453 /* Base */, {
    name: 'aave-hf-explode-showcase',
    inputs: {},
  });

  builder.aave.getHealthFactor('checkHf', {
    bind: {},
    config: { pool: AAVE_V3_POOL, user: signer },
    guards: [
      guards.coreNumericInvariant({
        port: 'healthFactor',
        op: 'gte',
        threshold: MIN_HEALTH_FACTOR_WAD,
      }),
    ],
  });

  const flow = builder.build();
  const request = sdk.request(flow, {
    signer,
    inputs: {},
    simulationPolicy: 'strict',
  });

  return { flow, request };
};
