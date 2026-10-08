import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

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
 * - `core.transfer` to move the whole input to a recipient address
 * - Binding a scalar handle input (`recipient`) alongside a resource input
 * - The `transferred` output port
 */
export const buildTransferTokens = ({
  owner,
  recipient,
  amount,
}: TransferTokensInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(1, {
    name: 'transfer-usdc',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
      recipient: 'address',
    },
  });

  // Transfer the full input amount to the recipient. The `transferred` port
  // tracks what the recipient received.
  builder.core.transfer('send', {
    bind: {
      amount: builder.inputs.amountIn,
      recipient: builder.inputs.recipient,
    },
    config: {},
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount }),
      recipient,
    },
  });

  return { flow, request };
};

/**
 * Transfer a fixed amount and swap the rest.
 *
 * Demonstrates:
 * - `core.splitAt` to carve a fixed sub-amount (`head`) out of a resource,
 *   leaving the rest in `tail`
 * - Sending `head` with `core.transfer` and using `tail` in a later operation
 */
export const buildPartialTransfer = ({
  owner,
  recipient,
  amount,
}: TransferTokensInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(1, {
    name: 'partial-transfer-usdc',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
      recipient: 'address',
    },
  });

  // Carve out a fixed 0.5 USDC (500000 base units at 6 decimals). Below that
  // amount, `head` takes the whole input and `tail` is 0.
  const { head, tail } = builder.core.splitAt('split', {
    bind: { source: builder.inputs.amountIn },
    config: { amount: '500000' },
  });

  builder.core.transfer('send-half', {
    bind: {
      amount: head,
      recipient: builder.inputs.recipient,
    },
    config: {},
  });

  // Swap the rest.
  builder.lifi.swap('swap-rest', {
    bind: { amountIn: tail },
    config: {
      resourceOut: resources.native(1),
      slippage: 0.03,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount }),
      recipient,
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
