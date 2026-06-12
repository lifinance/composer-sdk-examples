import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Example ERC-4626 vault address (Steakhouse USDC on Ethereum mainnet)
const VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

export interface EmitCustomEventInput {
  readonly owner: Address;
}

/**
 * Emit a custom on-chain event from a compose flow.
 *
 * Demonstrates:
 * - core.emitEvent2 — surfacing an arbitrary `Rebalance(address,uint256)` event
 * - Binding mixed-type handles (an `address` context ref and a `uint256` read)
 *   directly to the op's `bytes32` value ports — no `raw.ref` cast, because
 *   bytes32 ports are the raw 32-byte word type and accept any static-32-byte
 *   handle.
 *
 * The emitted log is a fixed VM event whose first data word is
 * keccak256("Rebalance(address,uint256)") (a discriminator), followed by the
 * execution address and the vault total — an indexer reads the discriminator
 * to recognise the event and decodes the two values.
 */
export const buildEmitCustomEvent = ({
  owner,
}: EmitCustomEventInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'emit-custom-event',
    inputs: {},
  });

  // Read the vault's total assets at execution time — a fresh uint256 handle.
  const vaultTotal = builder.core.staticCall('vault-total', {
    bind: {},
    config: {
      target: VAULT,
      functionSignature: 'function totalAssets() view returns (uint256)',
    },
  });

  // Emit Rebalance(address,uint256): the executing address plus the vault total.
  // value0 (address) and value1 (uint256) bind directly to the bytes32 ports.
  builder.core.emitEvent2('log-rebalance', {
    bind: {
      value0: builder.context.executionAddress,
      value1: vaultTotal.result,
    },
    config: {
      signature: 'Rebalance(address,uint256)',
    },
  });

  const flow = builder.build();

  // No `sweepTo`: this flow only reads and emits a log — it moves no funds, so
  // there are no proxy-held terminal resources to sweep. Specifying `sweepTo`
  // here would fail compilation with "no ... terminal resources ... to sweep".
  const request = sdk.request(flow, {
    signer: owner,
    inputs: {},
  });

  return { flow, request };
};
