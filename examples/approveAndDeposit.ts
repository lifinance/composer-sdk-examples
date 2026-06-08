import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Example ERC-4626 vault address (Steakhouse USDC on Ethereum mainnet)
const VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

export interface ApproveAndDepositInput {
  readonly owner: Address;
  readonly amount: `${bigint}`;
}

/**
 * Approve a vault to spend USDC, deposit into it, and track the resulting
 * shares as a resource.
 *
 * Demonstrates:
 * - core.approve to grant ERC20 allowance to the vault
 * - core.call to invoke the vault's deposit function
 * - core.asResource to graduate the raw return value to a tracked resource
 */
export const buildApproveAndDeposit = ({
  owner,
  amount,
}: ApproveAndDepositInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'approve-and-deposit',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
    },
  });

  // Approve the vault to spend our USDC.
  builder.core.approve('approve-vault', {
    bind: { amount: builder.inputs.amountIn },
    config: { spender: VAULT },
  });

  // Call vault.deposit(uint256 assets, address receiver) returns (uint256).
  // The input resource (USDC) is consumed by the call.
  // The `returns (uint256)` clause gives typed access to `.result` (shares minted).
  const depositResult = builder.core.call('deposit', {
    resource: builder.inputs.amountIn,
    bind: {
      assets: builder.inputs.amountIn,
      receiver: builder.context.executionAddress,
    },
    config: {
      target: VAULT,
      functionSignature:
        'function deposit(uint256 assets, address receiver) returns (uint256)',
    },
  });

  // Graduate the raw shares handle to a tracked resource so downstream
  // nodes can use it with slippage tracking and linearity checks.
  builder.core.asResource('shares', {
    bind: { handle: depositResult.result },
    config: {
      resource: resources.erc20(VAULT, 1),
    },
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
