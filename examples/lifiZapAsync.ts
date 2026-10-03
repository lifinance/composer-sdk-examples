import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { API_KEY, BASE_URL } from './config.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave aEthUSDC receipt token on Ethereum mainnet
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';

export interface LifiZapAsyncInput {
  readonly owner: Address;
  readonly recipient: Address;
}

/**
 * Zap USDC into a DeFi position whose output settles asynchronously via LI.FI.
 *
 * Demonstrates:
 * - `lifi.zapAsync`, the future-availability sibling of `lifi.zap`
 * - Binding the required `recipient` input (the async op has no optional
 *   recipient — the decl is non-optional, so `bind.recipient` is mandatory)
 * - Omitting `sweepTo`: a future delivery governs custody, so the
 *   output is delivered externally and never enters the execution VM — a
 *   sweep would find nothing to move (custody, not amount reporting)
 * - Amount reporting is unaffected by delivery timing: when the async lowering
 *   binds a terminal handle the output still reports an `amount.estimate`
 *   (`basis: 'simulated'`), the protocol's in-transaction expected value (the
 *   delivered amount arrives after settlement, when `delivery.when` is
 *   `'future'`). An `amount.minimum` appears only when a minimum source
 *   exists — for a future output that means a floor the edge lowering itself
 *   reported, never a user guard
 * - No output guards: the reported value is the initiating-transaction
 *   estimate, not the asynchronously delivered amount a guard could enforce,
 *   so `amountOut` is excluded from the generated `TypedGuard` union
 *   (`guards` typechecks as `TypedGuard<never>[]`) and the compiler rejects
 *   any guard on it
 */
export const buildLifiZapAsyncExample = ({
  owner,
  recipient,
}: LifiZapAsyncInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // Declare the flow with a single USDC input and the recipient address input.
  const builder = sdk.flow(1, {
    name: 'zap-async-usdc-to-aave',
    inputs: {
      amountIn: resources.erc20(USDC, 1),
      recipient: 'address',
    },
  });

  // Zap USDC into an async Aave position via LI.FI.
  // The future output is delivered to `recipient` once the initiating
  // transaction settles; the recipient binding is required by the op.
  builder.lifi.zapAsync('zap', {
    bind: {
      amountIn: builder.inputs.amountIn,
      recipient: builder.inputs.recipient,
    },
    config: {
      resourceOut: resources.erc20(A_ETH_USDC, 1),
    },
  });

  const flow = builder.build();

  // Build the compile request.
  // directDeposit transfers a fixed amount of USDC into the VM; the recipient
  // handle passes the delivery address as a plain string.
  // No `sweepTo`: the async output is delivered externally to the recipient,
  // never landing in the VM for a sweep to reach.
  // NOTE: no production edge sets `availability: 'future'` yet, so this request
  // resolves to a typed no_route today; it documents the intended shape.
  const request = sdk.request(flow, {
    signer: owner,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '1000000000' }),
      recipient,
    },
  });

  return { flow, request };
};
