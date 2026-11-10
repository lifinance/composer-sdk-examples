# AGENTS.md

Runnable TypeScript examples for [`@lifi/composer-sdk`](https://www.npmjs.com/package/@lifi/composer-sdk).
Each file in `examples/` exports a `build*` function that returns a
`ComposeCompileRequest` (`{ flow, run }`). The runner (`examples/run.ts`) prints that
request and sends it to a live Compose backend through `sdk.client.compile`. The
runner never signs or broadcasts a transaction. `@lifi/composer-sdk` and
`@lifi/compose-spec` are pinned together at `0.13.0` to match the production
server's `x-lifi-composer-version`. Keep those pins unless you also check the
target backend's version header. Do not switch to the `latest`, `next` or
`@staging` dist-tags. README.md explains why.

## Commands

The repo has no `justfile`. The contract verbs are npm scripts from
`package.json`. You need Node.js >= 24.

| Verb      | Command                      | Notes                                                        |
| --------- | ---------------------------- | ------------------------------------------------------------ |
| setup     | `npm install`                | Uses `package-lock.json`. A `yarn.lock` also exists.          |
| typecheck | `npm run typecheck`          | `tsc --noEmit` over `examples/`. Skips `examples/staged/`.    |
| test      | `npm test`                   | `tsx verify/contract.ts`. Uses mocked HTTP and makes no network calls. |
| run       | `npm run example <name>`     | Calls the live backend and needs `LIFI_API_KEY`. Run it without a name to list the examples. |

The repo has no lint or format script. Before you finish a change, run
`npm run typecheck` and `npm test`.

## Configuration

- `LIFI_API_KEY`: required for live runs. It is sent only in the
  `x-lifi-api-key` header. Never commit a real key.
- `COMPOSER_BASE_URL`: optional. It defaults to `https://composer.li.quest`.
- `examples/loadEnv.ts` loads `.env` if the file exists. `.env` is gitignored,
  and `.env.example` is the template.

## Layout

```
examples/
  run.ts         # runner entrypoint: maps example names to build* functions, compiles, prints
  config.ts      # shared config (base URL, API key, sample addresses)
  loadEnv.ts     # loads .env before config is read
  format.ts      # console output formatting
  <example>.ts   # one example per file, each exporting a build* function
  staged/        # flashloan / debt-migration examples; need lifi.flashloanRepay,
                 # which the pinned SDK lacks; excluded from typecheck, not runnable
verify/
  contract.ts    # local contract checks (request shape, API-key header, response decoding, errors)
```

## Conventions

- To add a runnable example, add `examples/<name>.ts` with a `build*` export,
  register it in `examples/run.ts` and add a row to the README example table.
- Some sources are reference-only and the runner does not wire them in:
  `aaveClaimRewards.ts`, `emitCustomEvent.ts`, `invariantChecks.ts`,
  `simulateCompiledSwap.ts` and `simulateRawTransaction.ts`. Keep this list
  matching the README.
- Imports use ESM with `.js` suffixes (`"type": "module"`, `NodeNext`
  resolution). TypeScript runs in `strict` mode with `noUnusedLocals`,
  `noUnusedParameters` and `noUncheckedIndexedAccess`.
- `npm test` does not show that a live compile works. A live compile needs
  `npm run example <name>` with a real key.
