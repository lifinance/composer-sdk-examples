import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

export interface SwapWithOutputValidationInput {
  readonly owner: Address;
  readonly amount: `${bigint}`;
  readonly expectedOut: `${bigint}`;
}

/**
 * Swap WETH to USDC, then validate the output amount against computed
 * slippage bounds.
 *
 * Demonstrates:
 * - core.bpsDown / core.bpsUp to compute lower and upper bounds
 * - core.subtract / core.add for threshold arithmetic
 * - All seven assertion ops for output validation
 */
export const buildSwapWithOutputValidation = ({
  owner,
  amount,
  expectedOut: _expectedOut,
}: SwapWithOutputValidationInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'swap-with-output-validation',
    inputs: {
      amountIn: resources.erc20(WETH, 1),
    },
  });

  // Swap WETH → USDC.
  const swapOutputs = builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.03,
    },
  });

  // Compute slippage bounds from the expected output.
  // Lower bound: expectedOut * (10000 - 300) / 10000 (3% slippage down)
  const lowerBound = builder.core.bpsDown('lower-bound', {
    bind: { value: swapOutputs.amountOut },
    config: { bps: 9700 },
  });

  // Upper bound: expectedOut * (10000 + 100) / 10000 (1% above expected)
  const upperBound = builder.core.bpsUp('upper-bound', {
    bind: { value: swapOutputs.amountOut },
    config: { bps: 10100 },
  });

  // Derive a margin value: upper - lower
  const margin = builder.core.subtract('margin', {
    bind: { a: upperBound.result, b: lowerBound.result },
  });

  // Sanity check: lower + margin should reconstruct the gap
  const reconstructed = builder.core.add('reconstructed', {
    bind: { a: lowerBound.result, b: margin.result },
  });

  // Validate: output >= lower bound
  builder.core.assertGte('check-gte-lower', {
    bind: { a: swapOutputs.amountOut, b: lowerBound.result },
  });

  // Validate: output <= upper bound
  builder.core.assertLte('check-lte-upper', {
    bind: { a: swapOutputs.amountOut, b: upperBound.result },
  });

  // Validate: output falls within [lower, upper] range
  builder.core.assertInRange('check-range', {
    bind: {
      value: swapOutputs.amountOut,
      min: lowerBound.result,
      max: upperBound.result,
    },
  });

  // Validate: upper bound > lower bound
  builder.core.assertGt('check-upper-gt-lower', {
    bind: { a: upperBound.result, b: lowerBound.result },
  });

  // Validate: lower bound < upper bound (inverse check)
  builder.core.assertLt('check-lower-lt-upper', {
    bind: { a: lowerBound.result, b: upperBound.result },
  });

  // Validate: reconstructed gap equals upper - lower identity
  builder.core.assertEqual('check-reconstruction', {
    bind: { a: reconstructed.result, b: upperBound.result },
  });

  // Validate: lower and upper bounds are distinct
  builder.core.assertNotEqual('check-bounds-distinct', {
    bind: { a: lowerBound.result, b: upperBound.result },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
