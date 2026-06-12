import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, raw } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Real ERC-4626 vault (Steakhouse USDC on Ethereum mainnet) queried through
// the untyped escape hatch.
const VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

export interface UntypedOpWithTypedRefInput {
  readonly owner: Address;
}

/**
 * Insert an untyped operation node, then feed its output into typed builder
 * methods using `raw.ref<T>()`.
 *
 * `untypedOp` is the escape hatch for ops the installed SDK's typed surface
 * doesn't cover — typically backend ops newer than your SDK version. The op
 * id is passed as a plain string and its bind/config shapes are not
 * type-checked, so the backend validates them at compile time instead.
 *
 * This example routes a real op (`core.staticCall`) through the untyped path
 * so the flow compiles end-to-end; the mechanism is identical for any op id.
 *
 * Demonstrates:
 * - `builder.untypedOp()` to add a node the typed API doesn't cover.
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
    inputs: {},
  });

  // Insert an untyped node querying the vault. untypedOp returns void —
  // the typed builder has no knowledge of this node's outputs.
  builder.untypedOp('vault-query', 'core.staticCall', {
    bind: {},
    config: {
      target: VAULT,
      functionSignature: 'function totalAssets() view returns (uint256)',
    },
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
    bind: { a: scaled.result, b: vaultResult },
  });

  const flow = builder.build();

  // No sweepTo: the flow reads state and asserts — it produces no resources.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {},
  });

  return { flow, request };
};
