import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Example ERC-4626 vault address (Steakhouse USDC on Ethereum mainnet)
const VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

export interface ReadContractStateInput {
  readonly owner: Address;
}

/**
 * Read on-chain state using three different strategies:
 * peek (compile-time), staticCall (execution-time), and balanceOf (resource).
 *
 * Demonstrates:
 * - core.peek to read a vault's totalAssets at compile time (baked as literal)
 * - core.staticCall to read totalSupply at execution time (fresh value)
 * - core.balanceOf to read a token balance as a tracked resource
 */
export const buildReadContractState = ({
  owner,
}: ReadContractStateInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'read-contract-state',
    inputs: {},
  });

  // Read vault totalAssets at compile time.
  // The result is resolved off-chain and baked into the program as a literal.
  builder.core.peek('total-assets', {
    bind: {},
    config: {
      target: VAULT,
      functionSignature: 'function totalAssets() view returns (uint256)',
    },
  });

  // Read vault totalSupply at execution time.
  // Unlike peek, this value is read on-chain during VM execution.
  builder.core.staticCall('total-supply', {
    bind: {},
    config: {
      target: VAULT,
      functionSignature: 'function totalSupply() view returns (uint256)',
    },
  });

  // Read the owner's USDC balance as a tracked resource.
  // Produces a resource handle that downstream nodes can consume.
  builder.core.balanceOf('usdc-balance', {
    bind: {},
    config: {
      token: USDC,
      owner,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {},
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
