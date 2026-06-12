/**
 * Example harness — builds a request and sends it to a live compose backend.
 *
 * Usage:
 *   COMPOSER_BASE_URL=https://composer.li.quest yarn example <name>
 *
 * Pass LIFI_API_KEY to authenticate:
 *   LIFI_API_KEY=your-key COMPOSER_BASE_URL=https://composer.li.quest yarn example <name>
 *
 * Available examples:
 *   aave-repay        — repay an Aave v3 WETH debt by supplying WETH
 *   aave-repay-atoken — repay an Aave v3 USDC debt by burning proxy aTokens
 *   aave-emode        — switch the proxy's Aave v3 eMode category
 *   approve-deposit   — approve vault allowance then deposit USDC
 *   consolidate       — consolidate ERC-20 balances to USDC
 *   consolidate-eth   — consolidate ERC-20 balances to native ETH
 *   deposit-proxy     — deposit tokens already on the proxy into Aave
 *   dust-sweep        — split USDC 80/20 and sweep leftover dust
 *   swap              — swap WETH to USDC via LI.FI
 *   split-zap         — split USDC 60/40 and zap into Aave + Morpho vaults
 *   split-arithmetic  — split USDC 70/30 with arithmetic assertions
 *   zap               — zap USDC into Aave lending position
 *   swap-zap          — swap WETH to USDC then zap into Aave
 *   swap-check        — swap WETH to USDC with balance check
 *   swap-recipient    — swap WETH + DAI to USDC and send to recipient
 *   swap-validate     — swap WETH to USDC with output validation bounds
 *   swap-allow-revert — swap WETH to USDC with allow-revert policy
 *   raw-call          — query a contract with raw calldata + arithmetic
 *   read-state        — read on-chain state via peek, staticCall, balanceOf
 *   redeem            — redeem ERC-4626 vault shares via core.call
 *   wrap-eth          — wrap native ETH into WETH via ValueCall
 *   transfer          — transfer full token balance to a recipient
 *   partial-transfer  — transfer a specific amount, keeping the remainder
 *   untyped-ref       — mix untypedOp with typed handles via raw.ref
 */
// Load a local `.env` (if present) before any other module reads process.env.
import "./loadEnv.js";

import type { ComposeCompileRequest } from "@lifi/compose-spec";

import { createComposeSdk } from "@lifi/composer-sdk";

import { buildAaveRepay } from "./aaveRepay.js";
import { buildAaveRepayWithATokens } from "./aaveRepayWithATokens.js";
import { buildAaveSetEMode } from "./aaveSetEMode.js";
import { buildApproveAndDeposit } from "./approveAndDeposit.js";
import { buildRedeemFromVault, buildWrapEth } from "./callContract.js";
import { API_KEY, BASE_URL, OWNER, PROXY, RECIPIENT } from "./config.js";
import { buildConsolidateToEth } from "./consolidateToEth.js";
import { buildConsolidateStablesToUsdc } from "./consolidateToUsdc.js";
import { buildDepositFromProxy } from "./depositFromProxy.js";
import { buildDustSweepExample } from "./dustSweep.js";
import { buildLifiSwapExample } from "./lifiSwap.js";
import { buildLifiZapExample } from "./lifiZap.js";
import { buildRawCallWithArithmetic } from "./rawCallWithArithmetic.js";
import { buildReadContractState } from "./readContractState.js";
import { buildSplitAndZapExample } from "./splitAndZap.js";
import { buildSplitWithArithmetic } from "./splitWithArithmetic.js";
import { buildSwapAndZapExample } from "./swapAndZap.js";
import { buildSwapToRecipient } from "./swapToRecipient.js";
import { buildSwapWithAllowRevertExample } from "./swapWithAllowRevert.js";
import { buildSwapWithBalanceCheck } from "./swapWithBalanceCheck.js";
import { buildSwapWithOutputValidation } from "./swapWithOutputValidation.js";
import { buildPartialTransfer, buildTransferTokens } from "./transferTokens.js";
import { buildUntypedOpWithTypedRef } from "./untypedOpWithTypedRef.js";

const EXAMPLES: Record<string, () => ComposeCompileRequest> = {
  "aave-repay": () =>
    buildAaveRepay({
      owner: OWNER,
      collateralAmount: "1000000000",
      borrowAmount: "100000000000000000",
      repayAmount: "101000000000000000",
    }).request,
  "aave-repay-atoken": () =>
    buildAaveRepayWithATokens({
      owner: OWNER,
      collateralAmount: "1000000000",
      borrowAmount: "500000000",
    }).request,
  "aave-emode": () => buildAaveSetEMode({ owner: OWNER }).request,
  "approve-deposit": () =>
    buildApproveAndDeposit({ owner: OWNER, amount: "1000000000" }).request,
  consolidate: () =>
    buildConsolidateStablesToUsdc({
      owner: OWNER,
      usdtAmount: "1000000000",
      daiAmount: "1000000000000000000000",
      fraxAmount: "1000000000000000000000",
      lusdAmount: "1000000000000000000000",
    }).request,
  "consolidate-eth": () =>
    buildConsolidateToEth({
      owner: OWNER,
      wethAmount: "1000000000000000000",
      usdcAmount: "1000000000",
      usdtAmount: "1000000000",
      daiAmount: "1000000000000000000000",
    }).request,
  "deposit-proxy": () =>
    buildDepositFromProxy({
      owner: OWNER,
      proxyAddress: PROXY,
      expectedAmount: "1000000000",
    }).request,
  "dust-sweep": () => buildDustSweepExample().request,
  swap: () => buildLifiSwapExample().request,
  "split-zap": () => buildSplitAndZapExample().request,
  "split-arithmetic": () =>
    buildSplitWithArithmetic({ owner: OWNER, amount: "1000000000" }).request,
  zap: () => buildLifiZapExample().request,
  "swap-zap": () => buildSwapAndZapExample().request,
  "swap-check": () =>
    buildSwapWithBalanceCheck({ owner: OWNER, amount: "1000000000000000000" })
      .request,
  "swap-recipient": () =>
    buildSwapToRecipient({
      owner: OWNER,
      recipient: RECIPIENT,
      wethAmount: "1000000000000000000",
      daiAmount: "500000000000000000000",
    }).request,
  "swap-validate": () =>
    buildSwapWithOutputValidation({
      owner: OWNER,
      amount: "1000000000000000000",
      expectedOut: "3000000000",
    }).request,
  "swap-allow-revert": () => buildSwapWithAllowRevertExample().request,
  "raw-call": () => buildRawCallWithArithmetic({ owner: OWNER }).request,
  "read-state": () => buildReadContractState({ owner: OWNER }).request,
  redeem: () =>
    buildRedeemFromVault({ owner: OWNER, amount: "1000000000000000000" })
      .request,
  "wrap-eth": () =>
    buildWrapEth({ owner: OWNER, amount: "1000000000000000000" }).request,
  transfer: () =>
    buildTransferTokens({
      owner: OWNER,
      recipient: RECIPIENT,
      amount: "1000000000",
    }).request,
  "partial-transfer": () =>
    buildPartialTransfer({
      owner: OWNER,
      recipient: RECIPIENT,
      amount: "1000000000",
    }).request,
  "untyped-ref": () => buildUntypedOpWithTypedRef({ owner: OWNER }).request,
};

const run = async () => {
  const args = process.argv.slice(2);
  const useStaged = args.includes("--staged");
  const name = args.find((arg) => arg !== "--staged");

  // Staged examples live under examples/staged/ and reference not-yet-prod
  // definitions, so they are deliberately excluded from this production file's
  // type-check. With --staged, pull their registry in via a NON-LITERAL dynamic
  // import (kept `any` to tsc, so the staged files are not dragged into the
  // production program). Requires the SDK to have been regenerated with
  // `yarn generate --staged` first, so the staged ops/materialisers exist at
  // runtime; run `yarn generate` afterwards to restore the production surface.
  let examples: Record<string, () => ComposeCompileRequest> = EXAMPLES;
  if (useStaged) {
    const stagedModule = (await import(
      `${import.meta.dirname}/staged/registry.js`
    )) as { STAGED_EXAMPLES: Record<string, () => ComposeCompileRequest> };
    examples = { ...EXAMPLES, ...stagedModule.STAGED_EXAMPLES };
  }

  const builder = name ? examples[name] : undefined;

  if (!builder) {
    const valid = Object.keys(examples).join(", ");
    console.error(
      `Error: ${
        name ? `unknown example "${name}"` : "no example specified"
      }\n` +
        `Valid examples: ${valid}\n` +
        `Usage: COMPOSER_BASE_URL=https://composer.li.quest yarn example [--staged] <name>`,
    );
    process.exit(1);
  }
  console.log(`Running example: ${name}`);

  const request = builder();
  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  console.log("--- Request ---");
  console.log(
    JSON.stringify(
      request,
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      2,
    ),
  );

  console.log(`\n--- Compiling against ${BASE_URL} ---`);
  const result = await sdk.client.compile(request);

  console.log("\n--- Result ---");
  console.log(JSON.stringify(result, null, 2));
};

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
