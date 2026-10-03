import type { ChainSummary } from '@lifi/composer-sdk';
import type { ComposeSdk } from '@lifi/composer-sdk';

/**
 * The slice of {@link ComposeSdk} these helpers need. Depending on the one
 * capability rather than the whole SDK keeps them testable with a two-line
 * fake, and documents that nothing here touches the compile path.
 */
export type SupportedChainsSource = Pick<ComposeSdk, 'getSupportedChains'>;

/**
 * A memoised view of the supported-chain list.
 */
export interface SupportedChainsCache {
  /** Supported chains, ascending by `chainId`. Fetched once, then served from memory. */
  readonly get: () => Promise<readonly ChainSummary[]>;
  /**
   * Resolves when `chainId` is supported, rejects with an actionable message
   * naming the alternatives when it is not.
   */
  readonly assertSupported: (chainId: number) => Promise<void>;
  /**
   * Display label for `chainId`, or `undefined` when the deployment does not
   * support it. Served from the same cached fetch as {@link get}.
   */
  readonly nameOf: (chainId: number) => Promise<string | undefined>;
  /** Drops the memoised list so the next {@link get} refetches. */
  readonly refresh: () => void;
}

/**
 * Wraps `sdk.getSupportedChains()` in a cache so a long-lived process pays for
 * one round trip instead of one per check.
 *
 * The SDK deliberately does not cache the list — the backend's chain registry
 * refreshes periodically, so the right lifetime is the caller's to choose.
 * Chains are added rarely, so caching for the life of a request handler (or
 * refreshing on a timer via {@link SupportedChainsCache.refresh}) is usually
 * right.
 *
 * Demonstrates:
 * - `sdk.getSupportedChains()`, the convenience accessor over `GET /chains`
 * - Preflighting a chain so an unsupported one fails locally with a message
 *   naming the alternatives, instead of costing a server round trip
 * - Turning the per-chain `name` into display labels without a second lookup
 *   or a hardcoded chain-name table
 * - Memoising the in-flight promise, not just the settled value, so concurrent
 *   first callers share one request
 */
export const createSupportedChainsCache = (
  sdk: SupportedChainsSource,
): SupportedChainsCache => {
  let inFlight: Promise<readonly ChainSummary[]> | undefined;

  const get = (): Promise<readonly ChainSummary[]> => {
    // A rejected fetch must not be memoised, or one transient network blip
    // would poison every later lookup.
    inFlight ??= sdk.getSupportedChains().catch((err: unknown) => {
      inFlight = undefined;
      throw err;
    });
    return inFlight;
  };

  const find = async (chainId: number): Promise<ChainSummary | undefined> =>
    (await get()).find((chain) => chain.chainId === chainId);

  return {
    get,
    assertSupported: async (chainId: number): Promise<void> => {
      if (await find(chainId)) return;
      const chains = await get();
      throw new Error(
        `Chain ${chainId} is not supported by this Compose deployment. ` +
          `Supported chains: ${chains
            .map((chain) => `${chain.name} (${chain.chainId})`)
            .join(', ')}`,
      );
    },
    nameOf: async (chainId: number): Promise<string | undefined> =>
      (await find(chainId))?.name,
    refresh: (): void => {
      inFlight = undefined;
    },
  };
};

/** Ethereum mainnet — supported by every deployment. */
const MAINNET = 1;
/** Not an EVM chain ID any deployment serves; stands in for a bad input. */
const UNSUPPORTED = 999_999;

/**
 * Harness entry point: prints the live chain list with names, then shows the
 * guard accepting a supported chain and rejecting an unsupported one.
 */
export const runSupportedChainsExample = async (
  sdk: SupportedChainsSource,
): Promise<void> => {
  const chains = createSupportedChainsCache(sdk);

  const supported = await chains.get();
  console.log(`Supported chains (${supported.length}):`);
  for (const { chainId, name } of supported) {
    console.log(`  ${chainId}\t${name}`);
  }

  await chains.assertSupported(MAINNET);
  // Served from cache: no second round trip.
  console.log(
    `\n${await chains.nameOf(MAINNET)} (${MAINNET}) is supported — safe to build a request.`,
  );

  await chains
    .assertSupported(UNSUPPORTED)
    .then(() => {
      throw new Error(`expected chain ${UNSUPPORTED} to be rejected`);
    })
    .catch((err: unknown) => {
      console.log(`\nGuard rejected as expected: ${(err as Error).message}`);
    });
};
