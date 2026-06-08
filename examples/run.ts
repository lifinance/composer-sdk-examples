/**
 * Example harness — builds a request and sends it to a live compose backend.
 *
 * Usage:
 *   COMPOSER_BASE_URL=https://composer.li.quest npm run example <name>
 *
 * Pass LIFI_API_KEY to authenticate:
 *   LIFI_API_KEY=your-key COMPOSER_BASE_URL=https://composer.li.quest npm run example <name>
 *
 * Available examples:
 *   aave-repay        — repay an Aave v3 WETH debt by supplying WETH
 *   aave-repay-atoken — repay an Aave v3 USDC debt by burning proxy aTokens
 *   aave-claim        — claim AAVE rewards and forward to a recipient
 *   aave-emode        — switch the executor's Aave v3 eMode category
 *   approve-deposit   — approve vault allowance then deposit USDC
 *   consolidate       — consolidate ERC-20 balances to USDC
 *   consolidate-eth   — consolidate ERC-20 balances to native ETH
 *   deposit-proxy     — deposit tokens already on the proxy into Aave
 *   dust-sweep        — split USDC 80/20 and sweep leftover dust
 *   swap              — swap WETH to USDC via LI.FI
 *   swap-fee          — swap WETH to USDC with a 50 bps integrator fee
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
 *   claim             — claim rewards from a contract (resource-free call)
 *   wrap-eth          — wrap native ETH into WETH via ValueCall
 *   transfer          — transfer full token balance to a recipient
 *   partial-transfer  — transfer a specific amount, keeping the remainder
 *   untyped-ref       — mix untypedOp with typed handles via raw.ref
 *
 * Staged examples (./staged/) — flashloan / lending / debt-migration flows.
 * A preview available during the ETHGlobal hackathon: they require the separate
 * `ethglobal-composer.li.quest` backend, which the runner targets automatically
 * (override with COMPOSER_BASE_URL). See ./staged/registry.ts for the full list.
 * Highlights:
 *   debt-migration    — migrate an Aave v3 debt position to Morpho Blue (Base)
 *   debt-migration-swap — debt migration that swaps the debt token en route
 *   debt-rebalance    — debt-swap an Aave position into a new debt token
 *   flashloan-repay   — borrow + repay round-trip via lifi.flashloanRepay
 *   aave-borrow / morpho-borrow / morpho-repay — single lending operations
 */
// Load a local `.env` (if present) before any other module reads process.env.
import './loadEnv.js';

import type { ComposeCompileRequest } from '@lifi/compose-spec';

import { createComposeSdk } from '@lifi/composer-sdk';

import { buildAaveClaimRewards } from './aaveClaimRewards.js';
import { buildAaveRepay } from './aaveRepay.js';
import { buildAaveRepayWithATokens } from './aaveRepayWithATokens.js';
import { buildAaveSetEMode } from './aaveSetEMode.js';
import { buildApproveAndDeposit } from './approveAndDeposit.js';
import {
  buildClaimRewards,
  buildRedeemFromVault,
  buildWrapEth,
} from './callContract.js';
import {
  API_KEY,
  BASE_URL,
  HAS_EXPLICIT_BASE_URL,
  OWNER,
  PROXY,
  RECIPIENT,
  STAGED_BASE_URL,
} from './config.js';
import { buildConsolidateToEth } from './consolidateToEth.js';
import { buildConsolidateStablesToUsdc } from './consolidateToUsdc.js';
import { buildDepositFromProxy } from './depositFromProxy.js';
import { buildDustSweepExample } from './dustSweep.js';
import { buildLifiSwapExample } from './lifiSwap.js';
import { buildLifiZapExample } from './lifiZap.js';
import { buildRawCallWithArithmetic } from './rawCallWithArithmetic.js';
import { buildReadContractState } from './readContractState.js';
import { buildSplitAndZapExample } from './splitAndZap.js';
import { buildSplitWithArithmetic } from './splitWithArithmetic.js';
import { buildSwapAndZapExample } from './swapAndZap.js';
import { buildSwapToRecipient } from './swapToRecipient.js';
import { buildSwapWithAllowRevertExample } from './swapWithAllowRevert.js';
import { buildSwapWithBalanceCheck } from './swapWithBalanceCheck.js';
import { buildSwapWithFeeExample } from './swapWithFee.js';
import { buildSwapWithOutputValidation } from './swapWithOutputValidation.js';
import {
  badge,
  banner,
  failure,
  field,
  formatError,
  info,
  jsonBlock,
  section,
  success,
  warn,
} from './format.js';
import { STAGED_EXAMPLES } from './staged/registry.js';
import { buildPartialTransfer, buildTransferTokens } from './transferTokens.js';
import { buildUntypedOpWithTypedRef } from './untypedOpWithTypedRef.js';

const EXAMPLES: Record<string, () => ComposeCompileRequest> = {
  'aave-repay': () =>
    buildAaveRepay({ owner: OWNER, amount: '500000000000000000' }).request,
  'aave-repay-atoken': () =>
    buildAaveRepayWithATokens({
      owner: OWNER,
      proxyAddress: PROXY,
      expectedATokenBalance: '1000000000',
    }).request,
  'aave-claim': () =>
    buildAaveClaimRewards({ owner: OWNER, recipient: RECIPIENT }).request,
  'aave-emode': () => buildAaveSetEMode({ owner: OWNER }).request,
  'approve-deposit': () =>
    buildApproveAndDeposit({ owner: OWNER, amount: '1000000000' }).request,
  consolidate: () =>
    buildConsolidateStablesToUsdc({
      owner: OWNER,
      usdtAmount: '1000000000',
      daiAmount: '1000000000000000000000',
      fraxAmount: '1000000000000000000000',
      lusdAmount: '1000000000000000000000',
    }).request,
  'consolidate-eth': () =>
    buildConsolidateToEth({
      owner: OWNER,
      wethAmount: '1000000000000000000',
      usdcAmount: '1000000000',
      usdtAmount: '1000000000',
      daiAmount: '1000000000000000000000',
    }).request,
  'deposit-proxy': () =>
    buildDepositFromProxy({
      owner: OWNER,
      proxyAddress: PROXY,
      expectedAmount: '1000000000',
    }).request,
  'dust-sweep': () => buildDustSweepExample().request,
  swap: () => buildLifiSwapExample().request,
  'swap-fee': () => buildSwapWithFeeExample().request,
  'split-zap': () => buildSplitAndZapExample().request,
  'split-arithmetic': () =>
    buildSplitWithArithmetic({ owner: OWNER, amount: '1000000000' }).request,
  zap: () => buildLifiZapExample().request,
  'swap-zap': () => buildSwapAndZapExample().request,
  'swap-check': () =>
    buildSwapWithBalanceCheck({ owner: OWNER, amount: '1000000000000000000' })
      .request,
  'swap-recipient': () =>
    buildSwapToRecipient({
      owner: OWNER,
      recipient: RECIPIENT,
      wethAmount: '1000000000000000000',
      daiAmount: '500000000000000000000',
    }).request,
  'swap-validate': () =>
    buildSwapWithOutputValidation({
      owner: OWNER,
      amount: '1000000000000000000',
      expectedOut: '3000000000',
    }).request,
  'swap-allow-revert': () => buildSwapWithAllowRevertExample().request,
  'raw-call': () => buildRawCallWithArithmetic({ owner: OWNER }).request,
  'read-state': () => buildReadContractState({ owner: OWNER }).request,
  redeem: () =>
    buildRedeemFromVault({ owner: OWNER, amount: '1000000000000000000' })
      .request,
  claim: () => buildClaimRewards({ owner: OWNER }).request,
  'wrap-eth': () =>
    buildWrapEth({ owner: OWNER, amount: '1000000000000000000' }).request,
  transfer: () =>
    buildTransferTokens({
      owner: OWNER,
      recipient: RECIPIENT,
      amount: '1000000000',
    }).request,
  'partial-transfer': () =>
    buildPartialTransfer({
      owner: OWNER,
      recipient: RECIPIENT,
      amount: '1000000000',
    }).request,
  'untyped-ref': () => buildUntypedOpWithTypedRef({ owner: OWNER }).request,
};

// Staged examples (flashloan / lending / debt migration) are looked up too, but
// listed separately: they build valid flows yet may be rejected by a default
// backend whose config gates the underlying ops. See ./staged/registry.ts.
const ALL_EXAMPLES: Record<string, () => ComposeCompileRequest> = {
  ...EXAMPLES,
  ...STAGED_EXAMPLES,
};

const run = async () => {
  const name = process.argv[2];
  const builder = name ? ALL_EXAMPLES[name] : undefined;
  const isStaged = !!name && name in STAGED_EXAMPLES;

  if (!builder) {
    console.error(
      failure(name ? `Unknown example "${name}"` : 'No example specified'),
    );
    console.error('');
    console.error(section('Examples'));
    console.error(`  ${Object.keys(EXAMPLES).join(', ')}`);
    console.error('');
    console.error(section('Staged (ETHGlobal preview backend)'));
    console.error(`  ${Object.keys(STAGED_EXAMPLES).join(', ')}`);
    console.error('');
    console.error(info('Usage: npm run example <name>'));
    process.exit(1);
  }

  // Staged examples are a hackathon preview served by a separate backend.
  // Auto-target it unless the user pinned COMPOSER_BASE_URL explicitly.
  const baseUrl =
    isStaged && !HAS_EXPLICIT_BASE_URL ? STAGED_BASE_URL : BASE_URL;

  console.log(banner(`LI.FI Composer · ${name}`));
  console.log(field('backend', baseUrl));
  console.log(
    field(
      'mode',
      isStaged
        ? `${badge('STAGED PREVIEW')} ETHGlobal hackathon only`
        : 'production',
    ),
  );
  if (!API_KEY) {
    console.log(warn('LIFI_API_KEY not set — the public backend will reject this request'));
  }
  console.log('');

  const request = builder();
  const sdk = createComposeSdk({ baseUrl, apiKey: API_KEY });

  console.log(section('Request'));
  console.log(jsonBlock(request));
  console.log('');

  console.log(info(`Compiling against ${baseUrl} …`));
  const startedAt = performance.now();
  const result = await sdk.client.compile(request);
  const elapsedMs = Math.round(performance.now() - startedAt);

  console.log(success(`Compiled in ${elapsedMs}ms`));
  console.log('');
  console.log(section('Result'));
  console.log(jsonBlock(result));
};

run().catch((err: unknown) => {
  console.error('');
  console.error(formatError(err));
  process.exit(1);
});
