import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

export interface SplitWithArithmeticInput {
  readonly owner: Address;
  readonly amount: `${bigint}`;
}

/**
 * Split USDC 70/30, then verify the parts with arithmetic and assertions.
 *
 * Demonstrates:
 * - core.add to reconstruct the whole from parts
 * - core.subtract to compute the difference between parts
 * - core.assertEqual to verify reconstruction matches the original
 * - core.assertNotEqual to verify the parts are distinct
 * - core.assertGt / core.assertLt to verify ordering of unequal parts
 */
export const buildSplitWithArithmetic = ({
  owner,
  amount,
}: SplitWithArithmeticInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'split-with-arithmetic',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Split USDC 70/30.
  const { a: larger, b: smaller } = builder.core.split('split', {
    bind: { source: builder.inputs.amountIn },
    config: { bps: 7000 },
  });

  // Add the two parts back together.
  const sum = builder.core.add('sum', {
    bind: { a: larger, b: smaller },
  });

  // Compute the difference between the larger and smaller portions.
  const diff = builder.core.subtract('diff', {
    bind: { a: larger, b: smaller },
  });

  // The sum of parts should equal the original input.
  builder.core.assertEqual('check-sum-equals-input', {
    bind: { a: sum.result, b: builder.inputs.amountIn },
  });

  // The two parts should not be equal (70/30 split).
  builder.core.assertNotEqual('check-parts-differ', {
    bind: { a: larger, b: smaller },
  });

  // The 70% portion should be strictly greater than the 30% portion.
  builder.core.assertGt('check-larger-gt-smaller', {
    bind: { a: larger, b: smaller },
  });

  // The 30% portion should be strictly less than the 70% portion.
  builder.core.assertLt('check-smaller-lt-larger', {
    bind: { a: smaller, b: larger },
  });

  // The difference should be greater than zero (non-trivial gap).
  builder.core.assertGt('check-diff-positive', {
    bind: { a: diff.result, b: smaller },
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
