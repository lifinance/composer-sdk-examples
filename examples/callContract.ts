import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Example ERC-4626 vault address (Steakhouse USDC on Ethereum mainnet)
const VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

export interface CallContractInput {
  readonly owner: Address;
  readonly amount: `${bigint}`;
}

/**
 * Redeem shares from an ERC-4626 vault back to the underlying token.
 *
 * Demonstrates:
 * - core.call with a human-readable function signature and typed args
 * - Inline approvals via the `approvals` config (alternative to a separate core.approve)
 * - `$handle` and `$context` argument references
 * - Threading the `result` output into core.asResource for downstream use
 */
export const buildRedeemFromVault = ({
  owner,
  amount,
}: CallContractInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'redeem-from-vault',
    inputs: {
      shares: resources.erc20(VAULT, 1),
    },
  });

  // Redeem vault shares for the underlying USDC.
  // - `input` binds the vault shares resource (consumed by the call)
  // - `approvals` grants the vault allowance inline (no separate approve node needed)
  // - `args` maps function parameters:
  //     $handle references a bound input by name
  //     $context references a runtime context value (e.g. the execution proxy address)
  // - `returns (uint256)` in the signature gives typed access to `.result`
  const redeemResult = builder.core.call('redeem', {
    resource: builder.inputs.shares,
    bind: {
      shares: builder.inputs.shares,
      receiver: builder.context.executionAddress,
      owner: builder.context.executionAddress,
    },
    config: {
      target: VAULT,
      functionSignature:
        'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
      approvals: [{ spender: VAULT }],
    },
  });

  // Graduate the raw uint256 return value to a tracked USDC resource
  // so downstream nodes can consume it with linearity and slippage tracking.
  builder.core.asResource('underlying', {
    bind: { handle: redeemResult.result },
    config: {
      resource: resources.erc20(USDC, 1),
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      shares: materialisers.directDeposit({ amount }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};

/**
 * Claim rewards from a contract that does not consume a token resource.
 *
 * Demonstrates:
 * - Resource-free core.call (no `resource` field) — routes to `core.invoke` internally
 * - `returns (uint256)` makes `.result` available for downstream use
 * - Graduating the raw result to a tracked resource via core.asResource
 */
export const buildClaimRewards = ({
  owner,
}: {
  readonly owner: Address;
}): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const REWARDS_CONTRACT = '0x1111111111111111111111111111111111111111';
  const REWARD_TOKEN = '0x2222222222222222222222222222222222222222';

  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'claim-rewards',
    inputs: {},
  });

  // Claim rewards — no token consumed, no resource needed.
  // The `returns (uint256)` clause enables typed access to `.result`.
  const claimResult = builder.core.call('claim', {
    bind: {},
    config: {
      target: REWARDS_CONTRACT,
      functionSignature: 'function claim() returns (uint256)',
    },
  });

  // Graduate the raw uint256 result to a tracked resource.
  builder.core.asResource('reward-token', {
    bind: { handle: claimResult.result },
    config: {
      resource: resources.erc20(REWARD_TOKEN, 1),
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

/**
 * Wrap native ETH into WETH using a ValueCall.
 *
 * Demonstrates:
 * - `callType: 'ValueCall'` to send native ETH value along with the call
 * - Calling a void payable function (no return value — `.result` is `undefined`)
 * - Using `core.balanceOf` to discover the minted WETH after a void call
 */
export const buildWrapEth = ({
  owner,
  amount,
}: CallContractInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'wrap-eth',
    inputs: {
      ethIn: resources.native(1),
    },
  });

  // WETH.deposit() is payable with no arguments — the ETH value sent
  // becomes the minted WETH amount. `callType: 'ValueCall'` forwards
  // the bound resource's value as msg.value.
  // deposit() returns void, so .result is undefined.
  builder.core.call('wrap', {
    resource: builder.inputs.ethIn,
    bind: {},
    config: {
      target: WETH,
      functionSignature: 'function deposit()',
      callType: 'ValueCall',
    },
  });

  // deposit() is void — read the minted WETH balance to get a tracked resource.
  builder.core.balanceOf('weth', {
    bind: {},
    config: {
      token: WETH,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      ethIn: materialisers.directDeposit({ amount }),
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
