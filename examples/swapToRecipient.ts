import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

export interface SwapToRecipientInput {
  readonly owner: Address;
  readonly recipient: Address;
  readonly wethAmount: `${bigint}`;
  readonly daiAmount: `${bigint}`;
}

/**
 * Swap WETH and DAI into USDC, merge the outputs, and deliver to a recipient.
 *
 * Demonstrates:
 * - Multiple resource inputs (two ERC-20 tokens)
 * - A handle input (recipient address as a scalar value)
 * - Chaining two swaps through a merge node
 * - Using `sweepTo` with a handle input to deliver tokens to the recipient
 * - Typed request inputs inferred from the flow schema
 */
export const buildSwapToRecipient = ({
  owner,
  recipient,
  wethAmount,
  daiAmount,
}: SwapToRecipientInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  // Declare the flow on Ethereum mainnet with two token inputs and one address input.
  const builder = sdk.flow(1, {
    name: 'swap-to-recipient',
    inputs: {
      wethIn: resources.erc20(WETH, 1),
      daiIn: resources.erc20(DAI, 1),
      recipient: 'address',
    },
  });

  // Swap WETH → USDC via LI.FI.
  const wethSwap = builder.lifi.swap('swap-weth', {
    bind: { amountIn: builder.inputs.wethIn },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.03,
    },
  });

  // Swap DAI → USDC via LI.FI.
  const daiSwap = builder.lifi.swap('swap-dai', {
    bind: { amountIn: builder.inputs.daiIn },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.03,
    },
  });

  // Merge the two USDC outputs into a single resource.
  builder.core.merge('merge-usdc', {
    bind: { a: wethSwap.amountOut, b: daiSwap.amountOut },
  });

  const flow = builder.build();

  // Build the compile request with typed inputs matching the flow schema.
  // Resource inputs use directDeposit materialisers with fixed amounts.
  // The handle input passes the recipient address as a plain string.
  // sweepTo delivers all terminal resources (the merged USDC) to the recipient.
  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      wethIn: materialisers.directDeposit({ amount: wethAmount }),
      daiIn: materialisers.directDeposit({ amount: daiAmount }),
      recipient,
    },
    sweepTo: recipient,
  });

  return { flow, request };
};
