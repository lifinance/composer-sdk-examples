import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, raw, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Example custom vault that the typed builder doesn't cover yet
const CUSTOM_VAULT = '0x1111111111111111111111111111111111111111';

export interface UntypedOpWithTypedRefInput {
  readonly owner: Address;
}

/**
 * Insert an untyped operation node for an unsupported operation, then feed
 * its output into typed builder methods using `raw.ref<T>()`.
 *
 * Demonstrates:
 * - `builder.untypedOp()` to add a node the typed API doesn't cover
 *   (e.g. a custom vault query).
 * - `raw.ref<'uint256'>()` to reference the untyped node's output in a typed
 *   `Bindable<'uint256'>` slot — the explicit type parameter is required
 *   so the compiler verifies the ref is used in a compatible slot.
 * - Mixing untyped and typed nodes in the same flow.
 */
export const buildUntypedOpWithTypedRef = ({
  owner,
}: UntypedOpWithTypedRefInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'untyped-op-with-typed-ref',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Insert an untyped node for a custom vault query. untypedOp returns void —
  // the typed builder has no knowledge of this node's outputs.
  builder.untypedOp('vault-query', 'custom.vaultQuery', {
    bind: { amount: { $ref: 'input.amountIn' } },
    config: { target: CUSTOM_VAULT },
  });

  // Use raw.ref to bridge the untyped node's output into a typed operation.
  // The type parameter <'uint256'> tells the compiler this ref produces a
  // uint256, so it's accepted by Bindable<'uint256'> slots.
  const vaultResult = raw.ref<'uint256'>('vault-query.result');

  // Feed the raw result into typed arithmetic — the compiler checks that
  // vaultResult (typed as uint256) is compatible with the uint256 bind slot.
  const scaled = builder.core.multiply('scale', {
    bind: { a: vaultResult, b: vaultResult },
  });

  // Continue with fully typed operations downstream.
  builder.core.assertGte('check-min', {
    bind: { a: scaled.result, b: builder.inputs.amountIn },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '1000000' }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
