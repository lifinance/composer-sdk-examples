import type { ComposeRouteRequest } from '@lifi/compose-spec';

import { routeAmount } from '@lifi/composer-sdk';

import { OWNER } from './config.js';

const NATIVE_ETH = '0x0000000000000000000000000000000000000000';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

/**
 * Wrap 0.1 native ETH into WETH on Ethereum mainnet through
 * `POST /compose/route`.
 *
 * Demonstrates:
 * - The convenience path: a from/to token pair instead of an authored flow.
 *   The pair resolves to the catalog's `wrap` edge, and the server authors the
 *   zap step for it
 * - `routeAmount.exact` for a fixed input amount (`bigint`, serialised on send)
 * - The native sentinel address as `fromToken`
 *
 * Pure: returns a plain {@link ComposeRouteRequest}, performs no network I/O.
 * Pass it to `sdk.route(...)` / `sdk.client.route(...)` to compile it.
 */
export const buildRouteExactExample = (): ComposeRouteRequest => ({
  chainId: 1,
  fromToken: NATIVE_ETH,
  toToken: WETH,
  amount: routeAmount.exact(100_000_000_000_000_000n), // 0.1 ETH
  signer: OWNER,
  slippageBps: 100,
});

/**
 * Unwrap the signer's entire WETH balance back into native ETH on Ethereum
 * mainnet — the catalog's `unwrap` edge.
 *
 * Demonstrates:
 * - `routeAmount.all` for a balance resolved on-chain at execution time, where
 *   the passed value is only the quoting stand-in
 * - `sweepTo` naming the address that receives the output
 * - `checkOnChainAllowances` so already-sufficient approvals are omitted from
 *   the response
 *
 * Pure: returns a plain {@link ComposeRouteRequest}, performs no network I/O.
 */
export const buildRouteAllExample = (): ComposeRouteRequest => ({
  chainId: 1,
  fromToken: WETH,
  toToken: NATIVE_ETH,
  // Estimate of the balance on hand — the quote and the derived preconditions
  // are computed against this, but the amount actually moved is the real
  // balance at execution time.
  amount: routeAmount.all(10n ** 18n), // ~1 WETH
  signer: OWNER,
  sweepTo: OWNER,
  slippageBps: 50,
  checkOnChainAllowances: true,
});
