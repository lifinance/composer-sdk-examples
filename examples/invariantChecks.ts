import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

export interface InvariantChecksInput {
  readonly owner: Address;
  readonly spender: Address;
  readonly amount: `${bigint}`;
  readonly minAmountOut: `${bigint}`;
}

/**
 * Swap WETH → USDC via LI.FI, then layer two of the newly-exposed invariant
 * ops on the result.
 *
 * Demonstrates:
 * - `invariant.gte` asserting the swap output is at least a constant threshold
 *   (`amountOut >= minAmountOut`) — the per-comparison shorthand for
 *   `invariant.numeric` with `{ op: 'gte' }`, so the comparison lives in the op
 *   name and the config is just `{ threshold }`.
 * - `invariant.allowanceAtLeast` asserting the execution proxy still permits
 *   `spender` to move at least the swapped USDC on its behalf.
 * - Binding a swap's `amountOut` resource handle into both a `uint256` numeric
 *   slot and a `resource` allowance slot.
 *
 * Both ops compile to on-chain `AssertRawInvariant` instructions; the run
 * reverts if either assertion is violated.
 */
export const buildInvariantChecks = ({
  owner,
  spender,
  amount,
  minAmountOut,
}: InvariantChecksInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // One WETH resource input plus a scalar spender address.
  const builder = sdk.flow(1, {
    name: 'invariant-checks',
    inputs: {
      amountIn: resources.erc20(WETH, 1),
      spender: 'address',
    },
  });

  // Swap WETH → USDC via LI.FI.
  const swapOutputs = builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.03,
    },
  });

  // Assert the swap produced at least `minAmountOut` USDC. The threshold is a
  // configured constant, so this is a numeric (not handle-vs-handle) compare;
  // `invariant.gte` is the shorthand that bakes the comparison into the op id.
  builder.invariant.gte('min-out', {
    bind: { value: swapOutputs.amountOut },
    config: { threshold: minAmountOut },
  });

  // Assert the execution proxy still grants `spender` an allowance of at least
  // the swapped USDC amount.
  builder.invariant.allowanceAtLeast('check-allowance', {
    bind: {
      minimumAmount: swapOutputs.amountOut,
      owner: builder.context.executionAddress,
      spender: builder.inputs.spender,
    },
  });

  const flow = builder.build();

  // directDeposit marks amountIn as a fixed amount of WETH pre-deposited into
  // the VM; the spender address is supplied as a plain scalar input.
  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount }),
      spender,
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
