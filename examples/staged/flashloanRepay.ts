import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { BASE_URL } from '../config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

export interface FlashloanRepayInput {
  readonly owner: Address;
  /** Principal to borrow (in the borrowed token's smallest units). */
  readonly amount: `${bigint}`;
  /**
   * Provider fee top-up (in the borrowed token's smallest units). Equals
   * `computeDefaultFee(providerKind, amount)` for the chosen provider.
   * For Aave v3 this is 5 bps of the principal.
   */
  readonly fee: `${bigint}`;
}

/**
 * Trivial smoke-test variant: borrow USDC via Aave v3, top up the protocol
 * fee via a `directDeposit`, and repay principal + fee back to the LiFi
 * flashloan adapter.
 *
 * Demonstrates the leg-vs-funds split introduced by the repay redesign:
 * - `config.leg` names the materialised flashloan input ("borrowed")
 * - `bind.funds` provides the principal-side handle (the borrowed handle)
 * - `bind.feeBuffer` provides the fee-side handle (the directDeposit)
 *
 * Both bindings exist purely to satisfy linearity; the op emits a single
 * `SafeTransfer(token, adapter, principal + fee)`.
 */
export const buildTrivialFlashloanRepay = ({
  owner,
  amount,
  fee,
}: FlashloanRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'flashloan-repay-trivial',
    inputs: {
      borrowed: resources.erc20(USDC, 1),
      feeTopUp: resources.erc20(USDC, 1),
    },
  });

  builder.lifi.flashloanRepay('repay', {
    bind: {
      funds: builder.inputs.borrowed,
      feeBuffer: builder.inputs.feeTopUp,
    },
    config: { leg: 'borrowed' },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      borrowed: materialisers.flashloan({
        providerKind: 'aave-v3',
        amount,
      }),
      feeTopUp: materialisers.directDeposit({ amount: fee }),
    },
  });

  return { flow, request };
};

export interface SwapAndRepayInput {
  readonly owner: Address;
  readonly amount: `${bigint}`;
}

/**
 * Realistic variant: borrow USDC, swap to WETH, swap back to USDC, then
 * repay using the swap-back's `amountOut` as the funds handle. No
 * `feeBuffer` is needed because the swap-back's output is sized to cover
 * `principal + fee` by construction.
 */
export const buildSwapAndRepay = ({
  owner,
  amount,
}: SwapAndRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'flashloan-swap-and-repay',
    inputs: {
      borrowed: resources.erc20(USDC, 1),
    },
  });

  const toWeth = builder.lifi.swap('swap-to-weth', {
    bind: { amountIn: builder.inputs.borrowed },
    config: {
      resourceOut: resources.erc20(WETH, 1),
      slippage: 0.005,
    },
  });

  const backToUsdc = builder.lifi.swap('swap-back-to-usdc', {
    bind: { amountIn: toWeth.amountOut },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.005,
    },
  });

  builder.lifi.flashloanRepay('repay', {
    bind: { funds: backToUsdc.amountOut },
    config: { leg: 'borrowed' },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      borrowed: materialisers.flashloan({
        providerKind: 'aave-v3',
        amount,
      }),
    },
  });

  return { flow, request };
};
