import {
  type ComposeCompileRequest,
  flashloanMaxFee,
  type Flow,
} from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';
import { API_KEY, BASE_URL } from '../config.js';

// Flashloans are enabled on Base only.
const BASE = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';

export interface FlashloanRepayInput {
  readonly owner: Address;
  /** Principal to borrow (in the borrowed token's smallest units). */
  readonly amount: `${bigint}`;
}

/**
 * Trivial smoke-test variant: borrow USDC via Aave v3 and top up the leg's fee
 * cap via a `directDeposit`, so the proxy holds the leg's reserve (principal
 * plus `maxFee`) when the flashloan runtime repays Aave after the program.
 *
 * Demonstrates two `lifi.flashloanRepay` nodes earmarking two handles of the
 * borrowed token. The op takes no config: it accepts any handle of a token
 * that a flashloan input borrows.
 * - `repay` binds `funds` to the borrowed handle (the principal)
 * - `repayFee` binds `funds` to the directDeposit handle (the fee top-up)
 *
 * The op emits no instruction: each node earmarks its handle for
 * settlement, so the flow reports neither as an output paid to the user.
 */
export const buildTrivialFlashloanRepay = ({
  owner,
  amount,
}: FlashloanRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(BASE, {
    name: 'flashloan-repay-trivial',
    inputs: {
      borrowed: resources.erc20(USDC, BASE),
      feeTopUp: resources.erc20(USDC, BASE),
    },
  });

  builder.experimental.lifi.flashloanRepay('repay', {
    bind: { funds: builder.inputs.borrowed },
  });

  builder.experimental.lifi.flashloanRepay('repayFee', {
    bind: { funds: builder.inputs.feeTopUp },
  });

  const flow = builder.build();

  // The leg's default fee cap: 5 bps of the principal, rounded up. The leg
  // states it and the top-up deposits it, so client and server agree on the
  // cap.
  const maxFee = flashloanMaxFee({ providerKind: 'aave-v3', amount });

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      borrowed: materialisers.experimental.flashloan({
        providerKind: 'aave-v3',
        amount,
        maxFee,
      }),
      feeTopUp: materialisers.directDeposit({ amount: maxFee }),
    },
    // The smoke flow keeps the principal and the fee top-up in the proxy for
    // settlement and produces no user output, so the guard sees the fee
    // top-up as 100% loss. 0 skips the check; the user's real cost is only
    // the provider fee.
    maxPriceImpactBps: 0,
  });

  return { flow, request };
};

/**
 * Realistic variant: borrow USDC, swap to WETH, swap back to USDC, then
 * earmark the swap-back's `amountOut` as the funds handle. No second repay
 * node: the swap-back's output must cover the leg's principal plus the Aave
 * fee on its own. If it falls short, the flight's settlement reverts
 * `FlashloanRepaymentShort`, which compose reports as a 400
 * `validation_error` with a `shortfall`.
 */
export const buildSwapAndRepay = ({
  owner,
  amount,
}: FlashloanRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(BASE, {
    name: 'flashloan-swap-and-repay',
    inputs: {
      borrowed: resources.erc20(USDC, BASE),
    },
  });

  const toWeth = builder.lifi.swap('swap-to-weth', {
    bind: { amountIn: builder.inputs.borrowed },
    config: {
      resourceOut: resources.erc20(WETH, BASE),
      slippage: 0.005,
    },
  });

  const backToUsdc = builder.lifi.swap('swap-back-to-usdc', {
    bind: { amountIn: toWeth.amountOut },
    config: {
      resourceOut: resources.erc20(USDC, BASE),
      slippage: 0.005,
    },
  });

  builder.experimental.lifi.flashloanRepay('repay', {
    bind: { funds: backToUsdc.amountOut },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      borrowed: materialisers.experimental.flashloan({
        providerKind: 'aave-v3',
        amount,
      }),
    },
  });

  return { flow, request };
};
