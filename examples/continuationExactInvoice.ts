import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import {
  type ComposeSdk,
  createComposeSdk,
  materialisers,
  raw,
  resources,
} from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

const BASE = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
// Request Network's ERC20FeeProxy on Base. It moves `amount` to `to` and
// `feeAmount` to `feeAddress` from the caller with `transferFrom`, and emits
// `TransferWithReferenceAndFee` with the payment reference: the event that
// marks the invoice paid.
const ERC20_FEE_PROXY = '0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814';
const VALIDITY_WINDOW_MS = 3_600_000;

/** A Request Network invoice payable in USDC on Base. */
export interface UsdcInvoice {
  readonly payee: Address;
  // USDC base units (6 decimals) paid to `payee`.
  readonly amount: bigint;
  // USDC base units paid to `feeAddress`; may be 0.
  readonly fee: bigint;
  readonly feeAddress: Address;
  // The invoice's payment reference (8 bytes for Request Network).
  readonly paymentReference: `0x${string}`;
}

export interface ContinuationExactInvoiceInput {
  readonly owner: Address;
  readonly invoice: UsdcInvoice;
  // USDC base units the escrow is funded with. Must exceed
  // `invoice.amount + invoice.fee`: the surplus, the settle's only outcome,
  // returns to `owner`, and an outcome must commit a positive floor.
  readonly usdcAmount: `${bigint}`;
}

export interface ContinuationExactSwapInvoiceInput {
  readonly owner: Address;
  readonly invoice: UsdcInvoice;
  // WETH base units (18 decimals) swapped to USDC. The swap's guaranteed
  // minimum output must exceed `invoice.amount + invoice.fee`, for the same
  // reason as `usdcAmount` above.
  readonly wethAmount: `${bigint}`;
}

/**
 * The leg both examples settle: split the invoice total off the escrowed
 * USDC, pay it through `ERC20FeeProxy`, and leave the surplus in the leg's
 * proxy as the settle's outcome.
 *
 * `core.call` declares no settlement verification, so only an exact settle
 * may run it. The invoice terms are constants of the leg document, so each
 * argument is a `raw.literal` of the parameter's Solidity type. The leg names
 * no funding amount: at fill the executor's proxy sweeps the escrowed USDC
 * into `input.funding`.
 */
const buildInvoiceLeg = (sdk: ComposeSdk, invoice: UsdcInvoice): Flow => {
  const leg = sdk.flow(BASE, {
    name: 'pay-invoice-leg',
    inputs: { funding: resources.erc20(USDC, BASE) },
  });
  // `head` is the invoice total; `tail`, the surplus, stays in the proxy.
  const { head } = leg.core.splitAt('invoice', {
    bind: { source: leg.inputs.funding },
    config: { amount: `${invoice.amount + invoice.fee}` },
  });
  leg.core.call('pay', {
    resource: head,
    bind: {
      tokenAddress: raw.literal('address', USDC),
      to: raw.literal('address', invoice.payee),
      amount: raw.literal('uint256', `${invoice.amount}`),
      paymentReference: raw.literal('bytes', invoice.paymentReference),
      feeAmount: raw.literal('uint256', `${invoice.fee}`),
      feeAddress: raw.literal('address', invoice.feeAddress),
    },
    config: {
      target: ERC20_FEE_PROXY,
      functionSignature:
        'function transferFromWithReferenceAndFee(address tokenAddress, address to, uint256 amount, bytes paymentReference, uint256 feeAmount, address feeAddress)',
      // The fee proxy pulls the USDC with `transferFrom`.
      approvals: [{ spender: ERC20_FEE_PROXY }],
    },
  });
  return leg.build();
};

/**
 * Escrow USDC on Base for an exact continuation leg that pays a Request
 * Network invoice, and return the surplus to the owner.
 *
 * Demonstrates:
 * - `exact: true` on `continuation.settle`: the escrow is bound to the leg's
 *   compiled calldata, so the solver runs exactly those bytes and chooses
 *   nothing. A committed (non-exact) leg rejects `core.call`, because a
 *   balance cannot prove that an invoice was paid; an exact leg admits it.
 * - A leg that pays a third party (`invoice.payee`), which only an exact leg
 *   may do: its bytes are fixed at compile time.
 * - The surplus (`usdcAmount` minus the invoice total) as the outcome. The
 *   compile proves its floor at the escrow's funding floor, so `minAmount` is
 *   omitted. A surplus of 0 proves no floor, and the compile rejects it.
 * - Funding from a declared input, transferred into the escrow inline by the
 *   user's transaction.
 *
 * Reading the response:
 * - `settlements.settle.escrow` holds the registered escrow. `binding` holds
 *   what the escrow is bound to: the solver's executor (`executionTarget`),
 *   the compiled leg (`calldata`), its `approvals`, and the `payload` the
 *   settlement service hashes into `payloadHash`.
 * - Inline funding means the user's `execute` transaction funds the escrow.
 *   Before submitting it, check that `payloadHash` is the hash of `payload`,
 *   for example with viem:
 *   `keccak256(binding.payload) === binding.payloadHash.toLowerCase()`.
 *   On a mismatch, do not submit.
 *
 * The exact-leg rules:
 * - No leg node may quote off-chain or declare an expiring route:
 *   `lifi.swap`, `paraswap.buy`, `core.peek` and any prepared op fail
 *   `validation_error` at the leg node, because the bound bytes cannot be
 *   re-quoted at fill.
 * - The settle's funding must be an ERC-20 from a declared input or an
 *   upstream output: native funding, or a bridge delivery into the escrow,
 *   fails `validation_error`.
 * - The deployment must serve exact legs (an intent-factory provider
 *   configured with the solver's executor); elsewhere the settle fails
 *   `validation_error` before any registration.
 */
export const buildContinuationExactInvoiceExample = ({
  owner,
  invoice,
  usdcAmount,
}: ContinuationExactInvoiceInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(BASE, {
    name: 'pay-invoice',
    inputs: { usdc: resources.erc20(USDC, BASE) },
  });
  builder.continuation.settle('settle', {
    bind: { input: builder.inputs.usdc },
    config: {
      exact: true,
      outcomes: [{ token: USDC, destination: owner, chainId: BASE }],
      validity: { expiresAtMs: Date.now() + VALIDITY_WINDOW_MS },
      provider: 'intent-factory',
      refund: owner,
      continuationFlow: buildInvoiceLeg(sdk, invoice),
    },
  });

  const flow = builder.build();

  // No `sweepTo`: the funding moves into the escrow, and the surplus reaches
  // the owner through the settlement, never through the user's proxy.
  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      usdc: materialisers.directDeposit({ amount: usdcAmount }),
    },
    // The price-impact check compares the flow's input value with its output
    // value. The invoice payment leaves the flow, so the check would count it
    // as lost value (1,050 USDC in, a 50 USDC surplus out: 95% impact) and
    // reject the compile. `0` disables the check.
    maxPriceImpactBps: 0,
  });

  return { flow, request };
};

/**
 * Pay the same USDC invoice from WETH: the user's transaction swaps WETH to
 * USDC and escrows the swap output for the exact leg.
 *
 * Demonstrates:
 * - An exact settle funded by an upstream output (`swap.amountOut`). The
 *   escrow's funding floor is the swap's guaranteed minimum output, and the
 *   leg is proven at that floor, so the minimum must exceed the invoice total.
 * - The quote rule applies to the leg only. The main flow runs inside the
 *   user's transaction, so its `lifi.swap` may quote; the leg, bound to fixed
 *   bytes until the fill, may not.
 */
export const buildContinuationExactSwapInvoiceExample = ({
  owner,
  invoice,
  wethAmount,
}: ContinuationExactSwapInvoiceInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  const builder = sdk.flow(BASE, {
    name: 'swap-and-pay-invoice',
    inputs: { weth: resources.erc20(WETH, BASE) },
  });
  const swap = builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.weth },
    config: { resourceOut: resources.erc20(USDC, BASE) },
  });
  builder.continuation.settle('settle', {
    bind: { input: swap.amountOut },
    config: {
      exact: true,
      outcomes: [{ token: USDC, destination: owner, chainId: BASE }],
      validity: { expiresAtMs: Date.now() + VALIDITY_WINDOW_MS },
      provider: 'intent-factory',
      refund: owner,
      continuationFlow: buildInvoiceLeg(sdk, invoice),
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      weth: materialisers.directDeposit({ amount: wethAmount }),
    },
    // The invoice payment leaves the flow, so the price-impact check would
    // count it as lost value. `0` disables the check, and with it the only
    // bound on the swap's price against the market. The swap's minimum output
    // bounds only slippage against its own quote. Before signing, compare
    // that minimum (`settlements.settle.escrow.floor` in the response) with
    // an independent WETH price.
    maxPriceImpactBps: 0,
  });

  return { flow, request };
};
