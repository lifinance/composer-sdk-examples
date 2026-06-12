# composer-sdk-examples

Runnable examples for [`@lifi/composer-sdk`](https://www.npmjs.com/package/@lifi/composer-sdk) — the TypeScript SDK for building and compiling LI.FI Compose flows into executable EVM calldata.

These examples are ported from the SDK's own `src/examples/` directory so they can be run directly, without digging through `node_modules`. Each example builds a `ComposeCompileRequest`; the runner sends it to a live Compose backend and prints the request and result.

Tracks the `@staging` release of `@lifi/composer-sdk` (and its lockstep `@lifi/compose-spec` peer) — see `package.json` for the pinned version.

## Setup

```bash
npm install
```

This pulls in `@lifi/composer-sdk` and its `@lifi/compose-spec` peer dependency (pinned in lockstep), plus `tsx` to run the TypeScript directly.

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

> The public backend requires an API key — expect a `ComposeError: API key is required` until `LIFI_API_KEY` is set.

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
| `swap-recipient`    | Swap WETH + DAI to USDC and send to a different recipient           |
| `swap-check`        | Swap WETH to USDC with a balance precondition                      |
| `swap-validate`     | Swap with computed slippage bounds (`bpsDown`/`bpsUp`/`assertInRange`) |
| `swap-allow-revert` | Swap with `simulationPolicy: 'allow-revert'`, handling partial results |
| `raw-call`          | Query a contract with pre-encoded calldata, then scale with arithmetic |
| `read-state`        | Compare `peek`, `staticCall`, and `balanceOf` reads                |
| `redeem`            | Redeem ERC-4626 vault shares via `core.call`                       |
| `wrap-eth`          | Wrap native ETH into WETH via a value call                         |
| `transfer`          | Transfer a full token balance to a recipient                       |
| `partial-transfer`  | Transfer a specific amount, keeping the remainder                  |
| `untyped-ref`       | Mix `untypedOp` with typed handles via `raw.ref`                   |

Example:

```bash
LIFI_API_KEY=your-key npm run example swap-zap
```

A few example sources are not wired into the runner and serve as copy-pasteable
references only: `swapWithFee.ts` (integrator fee), `aaveClaimRewards.ts` (claim
AAVE rewards), `buildClaimRewards` in `callContract.ts` (resource-free claim),
`emitCustomEvent.ts` (custom on-chain event via `core.emitEvent2`), and
`invariantChecks.ts` (`invariant.gte` / `invariant.allowanceAtLeast` guards).

### Staged examples (flashloan / lending / debt migration)

These live under `examples/staged/` and demonstrate flashloan-powered debt
migration and lending flows. They use staged ops that are published on the
`@staging` dist-tag but not yet enabled on the default production backend, so
run them with the `--staged` flag against the preview backend:

```bash
COMPOSER_BASE_URL=https://ethglobal-composer.li.quest npm run example -- --staged <name>
```

(`aave-hf-explode` additionally needs the signer to hold an Aave v3 position on
Base so the health factor resolves.)

| Name                            | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `debt-migration`                | Migrate an Aave v3 debt position to a Morpho Blue market (Base), via flashloan |
| `debt-migration-swap`           | Debt migration that swaps the debt token (e.g. USDC→EURC) en route   |
| `debt-migration-swap-exact-out` | Debt migration using an exact-output (`paraswap.buy`) debt swap       |
| `debt-rebalance`                | Debt-swap an Aave position into a new debt token, same protocol        |
| `flashloan-repay`               | Borrow + repay round-trip via `lifi.flashloanRepay`                   |
| `aave-borrow`                   | Borrow against Aave v3 collateral with an on-chain health-factor guard |
| `morpho-borrow`                 | Open a leveraged borrow position on a Morpho Blue market               |
| `morpho-repay`                  | Repay a Morpho Blue position and withdraw collateral                   |
| `aave-hf-explode`               | Decompose Aave health factor via the EXPLODE opcode; assert ≥ 1.0 WAD  |

## Project layout

```
examples/
  run.ts        # runner entrypoint — maps names to example builders, compiles, prints
  config.ts     # shared config (base URL, API key, sample addresses)
  loadEnv.ts    # loads .env (if present) before config is read
  <example>.ts  # one file per example, each exporting a build* function
  staged/       # flashloan / lending / debt-migration examples + their registry
```

Each example exports a `build*` function that returns `{ flow, request }`. The flow is built with the SDK's typed `FlowBuilder`; the runner compiles the request via `sdk.client.compile`. Read any example file alongside its row in the table above to see the SDK API in use.

## Type checking

```bash
npm run typecheck
```

## License

Apache-2.0 — matching the SDK.
