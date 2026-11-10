# composer-sdk-examples

Runnable examples for [`@lifi/composer-sdk`](https://www.npmjs.com/package/@lifi/composer-sdk) — the TypeScript SDK for building and compiling LI.FI Compose flows into executable EVM calldata.

These examples are ported from the SDK's own `src/examples/` directory so they can be run directly, without digging through `node_modules`. Each example builds a `ComposeCompileRequest`; the runner sends it to a live Compose backend and prints the request and result.

Tracks the server-compatible pair pinned in `package.json`: `@lifi/composer-sdk@0.13.0` and `@lifi/compose-spec@0.13.0`. On 2026-10-28, the production host `https://composer.li.quest` reported `x-lifi-composer-version: 0.13.0`. Requires Node.js >= 24, matching the SDK.

The npm tags are not a compatibility guarantee: on that date `next` was 0.14.0 and `latest` was 0.6.0. Neither matches the production server's minor version. Keep the explicit pins; before upgrading, check the target backend's `x-lifi-composer-version` response header and choose the matching SDK/spec pair.

## Setup

```bash
npm install
```

This pulls in `@lifi/composer-sdk` and its `@lifi/compose-spec` peer dependency (pinned in lockstep), plus `tsx` to run the TypeScript directly.

When copying an example into your own project, install the version pinned in `package.json` rather than a moving dist-tag, e.g. `npm install @lifi/composer-sdk@0.13.0 @lifi/compose-spec@0.13.0`. The npm `latest` tag can lag behind and may not include every op these examples use.

## Configuration

The examples read two environment variables (see [`.env.example`](./.env.example)):

| Variable             | Default                       | Description                              |
| -------------------- | ----------------------------- | ---------------------------------------- |
| `COMPOSER_BASE_URL`  | `https://composer.li.quest`   | Compose backend the flows compile against |
| `LIFI_API_KEY`       | _(none)_                      | API key for authenticated requests        |

You can provide them two ways:

```bash
# Inline:
LIFI_API_KEY=your-key npm run example swap

# Or copy the template and edit it (auto-loaded if present):
cp .env.example .env
```

> The key is sent in the `x-lifi-api-key` header, not the request body. Never commit a real key. The public backend requires an API key. Without `LIFI_API_KEY`, the runner sends the placeholder `YOUR_API_KEY` and the backend rejects the request.

## Running an example

```bash
npm run example <name>
```

Run with no name to see the full list. Available examples:

| Name                | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `swap`              | Swap WETH to USDC via LI.FI                                         |
| `zap`               | Zap USDC into an Aave lending position                             |
| `swap-zap`          | Swap WETH to USDC, then zap into Aave                              |
| `split-zap`         | Split USDC 60/40 and zap into Aave + Morpho vaults                |
| `split-arithmetic`  | Split USDC 70/30 with add/subtract/assertEqual assertions          |
| `dust-sweep`        | Split USDC 80/20 and sweep leftover dust back to the sender        |
| `deposit-proxy`     | Deposit tokens already on the proxy into Aave (with a precondition) |
| `approve-deposit`   | Approve a vault, deposit USDC, and graduate shares via `asResource` |
| `aave-repay`        | Repay an Aave v3 WETH debt by supplying WETH                       |
| `aave-repay-atoken` | Repay an Aave v3 USDC debt by burning proxy aTokens               |
| `aave-emode`        | Switch the executor's Aave v3 eMode category                       |
| `consolidate`       | Consolidate multiple ERC-20 balances into USDC                     |
| `consolidate-eth`   | Consolidate multiple ERC-20 balances into native ETH               |
| `continuation-settle` | Swap USDC to WETH on Base, escrow it for a deferred settlement that supplies it to Aave |
| `continuation-bridge-settle` | Bridge Arbitrum USDC into a Base settlement escrow that supplies it to Aave |
| `continuation-exact-invoice` | Escrow USDC on Base for an exact continuation leg that pays a Request Network invoice and returns the surplus |
| `continuation-exact-swap-invoice` | Swap WETH to USDC on Base and escrow the output for the same exact invoice leg |
| `swap-recipient`    | Swap WETH + DAI to USDC and send to a different recipient           |
| `swap-check`        | Swap WETH to USDC with a balance precondition                      |
| `swap-validate`     | Swap with computed slippage bounds (`bpsDown`/`bpsUp`/`assertInRange`) |
| `swap-allow-revert` | Swap with `simulationPolicy: 'allow-revert'`, handling partial results |
| `raw-call`          | Query a contract with pre-encoded calldata, then scale with arithmetic |
| `read-state`        | Compare `peek`, `staticCall`, and `balanceOf` reads                |
| `redeem`            | Redeem ERC-4626 vault shares via `core.call`                       |
| `wrap-eth`          | Wrap native ETH into WETH via a value call                         |
| `transfer`          | Transfer a full token balance to a recipient                       |
| `partial-transfer`  | Split off a fixed amount with `core.splitAt`, transfer it, swap the rest |
| `untyped-ref`       | Mix `untypedOp` with typed handles via `raw.ref`                   |
| `uniswap-v2-add`    | Split USDC, swap half to WETH, add both to the Uniswap V2 pair     |
| `uniswap-v3-mint`   | Open a full-range Uniswap V3 USDC/WETH position                    |
| `zap-async`         | Zap USDC into an async Aave position (future output)               |
| `fly-swap`          | Exit a Pendle PT via `lifi.zap`, then swap all proceeds to WETH with `fly.swap` |
| `aave-borrow`       | Supply USDC to Aave v3, borrow against it with a health-factor guard |
| `aave-hf-explode`   | Read the Aave v3 health factor via the EXPLODE opcode; assert ≥ 1.0 WAD |
| `morpho-borrow`     | Supply WETH collateral to a Morpho Blue market and borrow USDC     |
| `morpho-repay`      | Open, repay and close a Morpho Blue WETH/USDC position             |
| `route-exact`       | Wrap 0.1 native ETH into WETH via `sdk.route` (`/compose/route`)   |
| `route-all`         | Unwrap the whole WETH balance to ETH via `sdk.route`               |
| `supported-chains`  | List the chains the backend supports, and guard on them            |

Example:

```bash
LIFI_API_KEY=your-key npm run example swap-zap
```

A few example sources are not wired into the runner and serve as copy-pasteable
references only: `aaveClaimRewards.ts` (claim AAVE rewards), `buildClaimRewards`
in `callContract.ts` (resource-free claim), `emitCustomEvent.ts` (custom
on-chain event via `core.emitEvent2`), `invariantChecks.ts` (`invariant.gte` /
`invariant.allowanceAtLeast` guards), `simulateCompiledSwap.ts` and
`simulateRawTransaction.ts` (`sdk.simulate`).

`aave-hf-explode` needs the signer to hold an Aave v3 position on Base so the
health factor resolves.

The `continuation-*` examples escrow funds for a deferred settlement through the
`intent-factory` settlement provider. They compile only against a backend that
configures that provider, such as `https://composer.li.quest`.

The `continuation-exact-*` examples settle through an exact continuation leg
(`continuation.settle` with `exact: true`): the escrow is bound to the leg's
compiled calldata, so the leg may run a `core.call` to a third party, here
Request Network's `ERC20FeeProxy`. They also need the provider configured with
the solver's executor; any other backend rejects the settle with a
`validation_error`. In the response, `settlements.settle.binding` holds what the
escrow is bound to. Check that `binding.payloadHash` is
`keccak256(binding.payload)` before you submit the funding transaction.

The invoice payment leaves the flow, so the price-impact check would count it as
lost value. Both exact examples set `maxPriceImpactBps: 0` to disable the check.
In `continuation-exact-swap-invoice` that also removes the check's bound on the
swap's price: compare the swap's minimum output
(`settlements.settle.escrow.floor`) with an independent WETH price before
signing.

### Flashloan examples (staging SDK only)

These live under `examples/staged/`. They borrow through the `flashloan`
materialiser and earmark the repayment with `lifi.flashloanRepay`. Both exist
only in the staging build of the SDK, so the pinned 0.13.0 pair cannot run
them. They track the flashloan wire of `@lifi/composer-sdk` 0.16
([Yggdrasil#2444](https://github.com/lifinance/Yggdrasil/pull/2444)):

- A flow compiles to one `execute`. The flashloan runtime borrows each leg into
  the proxy before the program runs and repays every lender after it. The same
  transaction enables any lender adapter the proxy has not decided on yet;
  there is no separate enable action.
- `lifi.flashloanRepay` takes no config. It earmarks a handle of a borrowed
  token for settlement and moves nothing. A second earmark of the same token
  is a second node.
- The `flashloan` materialiser takes an optional `maxFee`, the most the lender
  may charge for the leg. It defaults to `flashloanMaxFee` from
  `@lifi/compose-spec` (Aave v3: 5 bps, rounded up; Balancer V2 and Morpho
  Blue: 0).
- Flashloans are enabled on Base (chain 8453) only. Every example runs on Base.

| Name                            | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `flashloan-repay`               | Borrow USDC from Aave v3 and repay it with a `directDeposit` of the fee cap |
| `debt-migration`                | Move an Aave v3 WETH/USDC position to a Morpho Blue market: two legs, Aave v3 and Balancer V2 |
| `debt-migration-swap`           | Debt migration that swaps the debt token (USDC to EURC) on the way   |
| `debt-migration-swap-exact-out` | Debt migration with an exact-output (`paraswap.buy`) debt swap        |
| `debt-rebalance`                | Swap an Aave v3 USDC debt into EURC debt on the same protocol         |

`flashloanRepay.ts` also exports `buildSwapAndRepay`, a reference-only
variant that repays the leg from a swap round trip.

To run them, install the staging pair over the pinned one, then use the
staged scripts:

```bash
npm run staged:install   # installs @lifi/composer-sdk@staging and @lifi/compose-spec@staging, lockfiles untouched
npm run typecheck:staged
LIFI_API_KEY=your-key npm run example:staged debt-migration
npm ci                   # restore the pinned 0.13.0 pair
```

A live compile also needs a backend that serves the flashloan wire and has
the v1.3 flashloan contracts deployed on Base. Until then the backend answers
422 `flashloan_unauthorized`. The staging SDK must also pass the backend's
version check: a staging SDK ahead of the backend's version gets
`server_outdated`.

## Project layout

```
examples/
  run.ts        # runner entrypoint — maps names to example builders, compiles, prints
  config.ts     # shared config (base URL, API key, sample addresses)
  loadEnv.ts    # loads .env (if present) before config is read
  <example>.ts  # one file per example, each exporting a build* function
  staged/       # flashloan examples (staging SDK only) + their registry
```

Each example exports a `build*` function. The runner takes the returned `request` (`{ flow, run }`), prints it, then calls `sdk.client.compile`. Building the request stays local; compile calls the backend but does not sign or broadcast a transaction. Read any example file alongside its row in the table above to see the SDK API in use.

## Type checking

```bash
npm run typecheck
```

The type check covers the production examples only. `examples/staged/` is
excluded because `lifi.flashloanRepay` and `materialisers.flashloan` exist only
in the staging SDK. After `npm run staged:install`, `npm run typecheck:staged`
checks every example, the flashloan ones included.

Run `npm test` for local swap-and-zap contract checks: request construction,
API-key header placement, success/partial response decoding, authentication
errors and server-version mismatch. These checks use mocked HTTP responses;
they do not prove that a live production compile succeeds.

## License

Apache-2.0 — matching the SDK.
