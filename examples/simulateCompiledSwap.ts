import type { SimulateResult } from '@lifi/compose-spec';

import { buildSimulateRequest, materialisers, resources } from '@lifi/composer-sdk';
import type { ComposeSdk } from '@lifi/composer-sdk';

import { OWNER } from './config.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

// 1 WETH (18 decimals).
const ONE_WETH = 1_000_000_000_000_000_000n;

/**
 * End-to-end `/simulate` usage: compile a WETH→USDC swap, then simulate the
 * compiled transaction to see how the signer's balances move and how much
 * inner-call gas it burns — without broadcasting anything on-chain.
 *
 * Demonstrates the compile → simulate arc:
 * - `buildSimulateRequest` lifts a `ComposeCompileResult` into a
 *   `SimulateRequest`, supplying the fields a compiled flow cannot carry: the
 *   target `chainId`, the `signer` (`from`), the funding `requirements`, and the
 *   `trackedBalances` to watch.
 * - `sdk.simulate` runs it and returns a discriminated `ok | revert | error`
 *   result. A `revert` is a *successful simulation* whose execution reverted, so
 *   it is returned (not thrown); only transport/auth/5xx failures throw.
 *
 * Unlike the pure-builder examples, this performs network I/O through the
 * injected `sdk` (one `/compose` call, one `/simulate` call). Pass a live
 * `createComposeSdk({ baseUrl })` to run it for real, or a mock-backed SDK in
 * tests.
 */
export const simulateCompiledSwap = async (
  sdk: ComposeSdk,
): Promise<SimulateResult> => {
  // Author and compile a single WETH → USDC swap on Ethereum mainnet.
  const builder = sdk.flow(1, {
    name: 'swap-weth-to-usdc',
    inputs: { amountIn: resources.erc20(WETH, 1) },
  });

  builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: { resourceOut: resources.erc20(USDC, 1), slippage: 0.03 },
  });

  const compiled = await builder.compile({
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: ONE_WETH }),
    },
    sweepTo: builder.context.sender,
  });

  // Lift the compiled transaction into a simulation request. The chain, signer,
  // funding, and watched balances are NOT inferable from a compiled flow, so
  // they are supplied here. `to`/`data`/`value` come from the compile result.
  const request = buildSimulateRequest({
    result: compiled,
    chainId: 1,
    signer: OWNER,
    // Seed the signer with the 1 WETH the swap deposits, so the inner call has
    // funds to pull. `bigint` amounts are serialised to decimal strings.
    requirements: [
      { type: 'Erc20Balance', wallet: OWNER, token: WETH, balance: ONE_WETH },
    ],
    // Watch the signer's WETH (spent) and USDC (received) balances; the response
    // `deltas` come back ordered to match.
    trackedBalances: [
      { token: WETH, owner: OWNER },
      { token: USDC, owner: OWNER },
    ],
  });

  return sdk.simulate(request);
};
