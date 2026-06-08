import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Example contract address for a non-standard oracle
const ORACLE = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';

export interface RawCallWithArithmeticInput {
  readonly owner: Address;
}

/**
 * Query a non-standard contract with pre-encoded calldata, then derive
 * values from the result using multiply, divideDown, and divideUp.
 *
 * Demonstrates:
 * - core.rawCall to invoke a contract with pre-encoded calldata
 * - core.multiply to scale a raw value
 * - core.divideDown / core.divideUp for rounding-aware division
 */
export const buildRawCallWithArithmetic = ({
  owner,
}: RawCallWithArithmeticInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'raw-call-with-arithmetic',
    inputs: {},
  });

  // Call an oracle contract with pre-encoded calldata for latestAnswer().
  // selector: 0x50d25bcd = keccak256("latestAnswer()")[:4]
  const oracleResult = builder.core.rawCall('read-oracle', {
    bind: {},
    config: {
      target: ORACLE,
      calldata: '0x50d25bcd',
      callType: 'StaticCall',
      resultType: 'uint256',
    },
  });

  // Scale the oracle result by multiplying with itself.
  // This models squaring a price value for demonstration purposes.
  const scaled = builder.core.multiply('scale-up', {
    bind: { a: oracleResult.result, b: oracleResult.result },
  });

  // Divide down (floor) by a divisor — models conservative conversion.
  const floorResult = builder.core.divideDown('floor-convert', {
    bind: { a: scaled.result, b: oracleResult.result },
  });

  // Divide up (ceil) by the same divisor — models optimistic conversion.
  const ceilResult = builder.core.divideUp('ceil-convert', {
    bind: { a: scaled.result, b: oracleResult.result },
  });

  // Verify the floor result is no greater than the ceil result.
  builder.core.assertLte('check-floor-lte-ceil', {
    bind: { a: floorResult.result, b: ceilResult.result },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {},
  });

  return { flow, request };
};
