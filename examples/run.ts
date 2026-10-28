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
 *   aave-borrow       — supply USDC to Aave v3, borrow against it with a health-factor guard
 *   aave-hf-explode   — read the Aave v3 health factor and assert it stays >= 1.0
 *   aave-repay        — repay an Aave v3 WETH debt by supplying WETH
 *   aave-repay-atoken — repay an Aave v3 USDC debt by burning proxy aTokens
 *   aave-emode        — switch the proxy's Aave v3 eMode category
 *   approve-deposit   — approve vault allowance then deposit USDC
 *   consolidate       — consolidate ERC-20 balances to USDC
 *   consolidate-eth   — consolidate ERC-20 balances to native ETH
 *   continuation-settle        — swap USDC to WETH on Base, escrow it for a deferred settlement
 *   continuation-bridge-settle — bridge Arbitrum USDC into a Base settlement escrow
 *   continuation-exact-invoice      — escrow USDC on Base for an exact leg that pays a Request Network invoice
 *   continuation-exact-swap-invoice — swap WETH to USDC on Base, escrow it for the same exact invoice leg
 *   deposit-proxy     — deposit tokens already on the proxy into Aave
 *   dust-sweep        — split USDC 80/20 and sweep leftover dust
 *   swap              — swap WETH to USDC via LI.FI
 *   split-zap         — split USDC 60/40 and zap into Aave + Morpho vaults
 *   split-arithmetic  — split USDC 70/30 with arithmetic assertions
 *   zap               — zap USDC into Aave lending position
 *   zap-async         — zap USDC into an async Aave position (future output)
 *   morpho-borrow     — supply WETH collateral to Morpho Blue and borrow USDC
 *   morpho-repay      — open, repay and close a Morpho Blue WETH/USDC position
 *   fly-swap          — exit a Pendle PT position and swap ALL proceeds to WETH
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
 *   partial-transfer  — split off a fixed amount with core.splitAt, transfer it, swap the rest
 *   untyped-ref       — mix untypedOp with typed handles via raw.ref
 *   uniswap-v2-add    — split USDC, swap half to WETH, add both to the Uniswap V2 pair
 *   uniswap-v3-mint   — open a full-range Uniswap V3 USDC/WETH position
 *   route-exact       — wrap 0.1 native ETH into WETH via /compose/route
 *   route-all         — unwrap the whole WETH balance to ETH via /compose/route
 *   supported-chains  — list the chains this deployment supports, and guard on them
 */
// Load a local `.env` (if present) before any other module reads process.env.
import './loadEnv.js';

import type {
  ComposeCompileRequest,
  ComposeRouteRequest,
} from '@lifi/compose-spec';

import {
  type ComposeCompileResult,
  type ComposeSdk,
  createComposeSdk,
  isComposeError,
  isComposeSdkOutdatedError,
  isComposeServerOutdatedError,
} from '@lifi/composer-sdk';

import { buildAaveBorrow } from './aaveBorrow.js';
import { buildAaveHealthFactorExplode } from './aaveHealthFactorExplode.js';
import { buildAaveRepay } from './aaveRepay.js';
import { buildAaveRepayWithATokens } from './aaveRepayWithATokens.js';
import { buildAaveSetEMode } from './aaveSetEMode.js';
import { buildApproveAndDeposit } from './approveAndDeposit.js';
import { buildRedeemFromVault, buildWrapEth } from './callContract.js';
import { API_KEY, BASE_URL, OWNER, PROXY, RECIPIENT } from './config.js';
import { buildConsolidateToEth } from './consolidateToEth.js';
import { buildConsolidateStablesToUsdc } from './consolidateToUsdc.js';
import { buildContinuationBridgeSettleExample } from './continuationBridgeSettle.js';
import {
  buildContinuationExactInvoiceExample,
  buildContinuationExactSwapInvoiceExample,
  type UsdcInvoice,
} from './continuationExactInvoice.js';
import { buildContinuationSettleExample } from './continuationSettle.js';
import { buildDepositFromProxy } from './depositFromProxy.js';
import { buildDustSweepExample } from './dustSweep.js';
import { buildFlySwapExample } from './flySwap.js';
import { buildLifiSwapExample } from './lifiSwap.js';
import { buildLifiZapExample } from './lifiZap.js';
import { buildLifiZapAsyncExample } from './lifiZapAsync.js';
import { buildMorphoBlueBorrow } from './morphoBlueBorrow.js';
import { buildMorphoBlueRepay } from './morphoBlueRepay.js';
import { buildRawCallWithArithmetic } from './rawCallWithArithmetic.js';
import { buildReadContractState } from './readContractState.js';
import {
  buildRouteAllExample,
  buildRouteExactExample,
} from './routeTokenPair.js';
import { buildSplitAndZapExample } from './splitAndZap.js';
import { buildSplitWithArithmetic } from './splitWithArithmetic.js';
import { runSupportedChainsExample } from './supportedChains.js';
import { buildSwapAndZapExample } from './swapAndZap.js';
import { buildSwapToRecipient } from './swapToRecipient.js';
import { buildSwapWithAllowRevertExample } from './swapWithAllowRevert.js';
import { buildSwapWithBalanceCheck } from './swapWithBalanceCheck.js';
import { buildSwapWithOutputValidation } from './swapWithOutputValidation.js';
import { buildPartialTransfer, buildTransferTokens } from './transferTokens.js';
import { buildUniswapV2AddLiquidity } from './uniswapV2AddLiquidity.js';
import { buildUniswapV3Mint } from './uniswapV3Mint.js';
import { buildUntypedOpWithTypedRef } from './untypedOpWithTypedRef.js';

const stringifyJson = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );

// A sample invoice for the exact-leg examples: 990 USDC to the payee plus a
// 10 USDC fee.
const SAMPLE_INVOICE: UsdcInvoice = {
  payee: RECIPIENT,
  amount: 990_000_000n,
  fee: 10_000_000n,
  feeAddress: '0x2222222222222222222222222222222222222222',
  paymentReference: '0x8c6f1d3b4a5e7c21',
};

const EXAMPLES: Record<string, () => ComposeCompileRequest> = {
  'aave-borrow': () =>
    buildAaveBorrow({
      owner: OWNER,
      recipient: RECIPIENT,
      collateralAmount: '1000000000',
      borrowAmount: '500000000',
    }).request,
  'aave-hf-explode': () =>
    buildAaveHealthFactorExplode({ signer: OWNER }).request,
  'aave-repay': () =>
    buildAaveRepay({
      owner: OWNER,
      collateralAmount: '1000000000',
      borrowAmount: '100000000000000000',
      repayAmount: '101000000000000000',
    }).request,
  'aave-repay-atoken': () =>
    buildAaveRepayWithATokens({
      owner: OWNER,
      collateralAmount: '1000000000',
      borrowAmount: '500000000',
    }).request,
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
  'continuation-settle': () =>
    buildContinuationSettleExample({ owner: OWNER }).request,
  'continuation-bridge-settle': () =>
    buildContinuationBridgeSettleExample({ owner: OWNER }).request,
  'continuation-exact-invoice': () =>
    buildContinuationExactInvoiceExample({
      owner: OWNER,
      invoice: SAMPLE_INVOICE,
      usdcAmount: '1050000000',
    }).request,
  'continuation-exact-swap-invoice': () =>
    buildContinuationExactSwapInvoiceExample({
      owner: OWNER,
      invoice: SAMPLE_INVOICE,
      wethAmount: '1000000000000000000',
    }).request,
  'deposit-proxy': () =>
    buildDepositFromProxy({
      owner: OWNER,
      proxyAddress: PROXY,
      expectedAmount: '1000000000',
    }).request,
  'dust-sweep': () => buildDustSweepExample().request,
  swap: () => buildLifiSwapExample().request,
  'split-zap': () => buildSplitAndZapExample().request,
  'split-arithmetic': () =>
    buildSplitWithArithmetic({ owner: OWNER, amount: '1000000000' }).request,
  zap: () => buildLifiZapExample().request,
  'zap-async': () =>
    buildLifiZapAsyncExample({ owner: OWNER, recipient: RECIPIENT }).request,
  'fly-swap': () => buildFlySwapExample().request,
  'morpho-borrow': () =>
    buildMorphoBlueBorrow({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      borrowAmount: '1200000000',
    }).request,
  'morpho-repay': () =>
    buildMorphoBlueRepay({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      borrowAmount: '500000000',
      repayAmount: '501000000',
    }).request,
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
  'uniswap-v2-add': () =>
    buildUniswapV2AddLiquidity({ owner: OWNER, usdcAmount: '1000000000' })
      .request,
  'uniswap-v3-mint': () =>
    buildUniswapV3Mint({
      owner: OWNER,
      usdcAmount: '1000000000',
      wethAmount: '400000000000000000',
    }).request,
};

// `/compose/route` examples build a `ComposeRouteRequest` and go to
// `sdk.route`, not `sdk.client.compile`, so they live in their own registry.
const ROUTE_EXAMPLES: Record<string, () => ComposeRouteRequest> = {
  'route-exact': buildRouteExactExample,
  'route-all': buildRouteAllExample,
};

// Query examples read from the API instead of building a request to compile,
// so they take the sdk and print their own output.
const QUERY_EXAMPLES: Record<string, (sdk: ComposeSdk) => Promise<void>> = {
  'supported-chains': runSupportedChainsExample,
};

const printCompileSummary = (result: ComposeCompileResult): void => {
  const approvals = result.approvals?.length ?? 0;
  const tx = result.transactionRequest;
  const lines = [
    `status: ${result.status}`,
    `userProxy: ${result.userProxy}`,
    `approvals: ${approvals}`,
    tx
      ? `transactionRequest: to=${tx.to} chainId=${tx.chainId} value=${tx.value} gasLimit=${tx.gasLimit ?? 'absent'}`
      : 'transactionRequest: absent',
    'signed: no; broadcast: no',
  ];
  if (result.status === 'partial') {
    lines.push(
      `partial: ${result.error.kind} ${result.error.message}; simulationRevert.code=${result.simulationRevert.code}`,
    );
  }
  console.log(lines.join('\n'));
};

const printComposeError = (err: unknown): void => {
  if (isComposeSdkOutdatedError(err)) {
    console.error(`compose version mismatch: ${err.kind} ${err.message}`);
    return;
  }
  if (isComposeServerOutdatedError(err)) {
    console.error(`compose version mismatch: ${err.kind} ${err.message}`);
    return;
  }
  if (isComposeError(err)) {
    console.error(
      `compose error: code=${err.code} kind=${err.kind ?? 'none'} status=${err.status ?? 'none'} ${err.message}`,
    );
    return;
  }
  console.error(err);
};

const run = async () => {
  const args = process.argv.slice(2);
  const useStaged = args.includes('--staged');
  const name = args.find((arg) => arg !== '--staged');

  // Staged examples reference lifi.flashloanRepay, which the pinned 0.13.0 SDK
  // does not generate. --staged loads them without pulling them into the
  // production type-check. Do not install the npm staging tag (0.4.0-staging.1)
  // over this checkout: that pair is incompatible with the live 0.13.0 server.
  let examples: Record<string, () => ComposeCompileRequest> = EXAMPLES;
  if (useStaged) {
    const stagedModule = (await import(
      `${import.meta.dirname}/staged/registry.js`
    )) as { STAGED_EXAMPLES: Record<string, () => ComposeCompileRequest> };
    examples = { ...EXAMPLES, ...stagedModule.STAGED_EXAMPLES };
  }

  const queryExample = name ? QUERY_EXAMPLES[name] : undefined;
  const routeBuilder = name ? ROUTE_EXAMPLES[name] : undefined;
  const builder = name ? examples[name] : undefined;

  if (!builder && !routeBuilder && !queryExample) {
    const valid = [
      ...Object.keys(examples),
      ...Object.keys(ROUTE_EXAMPLES),
      ...Object.keys(QUERY_EXAMPLES),
    ]
      .sort()
      .join(', ');
    console.error(
      `Error: ${
        name ? `unknown example "${name}"` : 'no example specified'
      }\n` +
        `Valid examples: ${valid}\n` +
        `Usage: COMPOSER_BASE_URL=https://composer.li.quest npm run example -- [--staged] <name>`,
    );
    process.exit(1);
  }
  console.log(`Running example: ${name}`);

  const sdk = createComposeSdk({ baseUrl: BASE_URL, apiKey: API_KEY });

  // Query examples do their own I/O and printing - there is no request to
  // show and nothing to compile.
  if (queryExample) {
    console.log(`\n--- Querying ${BASE_URL} ---`);
    await queryExample(sdk);
    return;
  }

  const request = routeBuilder ? routeBuilder() : builder!();

  console.log('--- Request ---');
  console.log(stringifyJson(request));

  console.log(`\n--- Compiling against ${BASE_URL} ---`);
  const result = routeBuilder
    ? await sdk.route(request as ComposeRouteRequest)
    : await sdk.client.compile(request as ComposeCompileRequest);

  console.log('\n--- Result ---');
  if (!routeBuilder) {
    printCompileSummary(result as ComposeCompileResult);
  }
  console.log(stringifyJson(result));
};

run().catch((err: unknown) => {
  printComposeError(err);
  process.exit(1);
});
