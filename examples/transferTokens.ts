import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

export interface TransferTokensInput {
  readonly owner: Address;
  readonly recipient: Address;
  readonly amount: `${bigint}`;
}

/**
 * Transfer ERC-20 tokens from the proxy to an arbitrary recipient.
 *
 * Demonstrates:
 * - `core.transfer` to move tokens to a recipient address
 * - Binding a scalar handle input (`recipient`) alongside a resource input
 * - Optionally specifying a partial transfer amount via `config.amount`
 *   (omit to transfer the full balance)
 * - The `transferred` and `remainder` output ports
 */
export const buildTransferTokens = ({
  owner,
  recipient,
  amount,
}: TransferTokensInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'transfer-usdc',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
      recipient: 'address',
    },
  });

  // Transfer the full input amount to the recipient.
  // The `transferred` port tracks what was sent; `remainder` tracks what's left.
  builder.core.transfer('send', {
    bind: {
      amount: builder.inputs.amountIn,
      recipient: builder.inputs.recipient,
    },
    config: {},
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount }),
      recipient,
    },
  });

  return { flow, request };
};

/**
 * Transfer a partial amount, keeping the remainder in the proxy.
 *
 * Demonstrates:
 * - `config.amount` to transfer a specific sub-amount
 * - Using the `remainder` output port for subsequent operations
 */
export const buildPartialTransfer = ({
  owner,
  recipient,
  amount,
}: TransferTokensInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'partial-transfer-usdc',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
      recipient: 'address',
    },
  });

  // Transfer a fixed 0.5 USDC (500000 base units at 6 decimals);
  // the remainder stays on the proxy for subsequent operations.
  const out = builder.core.transfer('send-half', {
    bind: {
      amount: builder.inputs.amountIn,
      recipient: builder.inputs.recipient,
    },
    config: { amount: '500000' },
  });

  // Use the remainder in a swap.
  builder.lifi.swap('swap-remainder', {
    bind: { amountIn: out.remainder },
    config: {
      resourceOut: resources.native(1),
      slippage: 0.03,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount }),
      recipient,
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
