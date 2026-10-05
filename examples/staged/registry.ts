// Registry of staged (not-yet-prod) examples for the live runner. This is data,
// not a runner: src/examples/run.ts imports it via a non-literal dynamic import
// when invoked with `--staged`, so this file (which references staged definitions)
// is never pulled into the production type-check. It IS type-checked under
// tsconfig.staged.json (see verify:staged).
//
// Running these requires the SDK regenerated with `--staged`; the example:staged
// wrapper does that and restores production afterward.
import type { ComposeCompileRequest } from '@lifi/compose-spec';

import { OWNER, RECIPIENT } from '../config.js';

import { buildAaveDebtRebalanceExactOut } from './aaveDebtRebalanceExactOut.js';
import { buildAaveToMorphoDebtMigration } from './aaveToMorphoDebtMigration.js';
import { buildAaveToMorphoDebtMigrationWithSwap } from './aaveToMorphoDebtMigrationWithSwap.js';
import { buildAaveToMorphoDebtMigrationWithSwapExactOut } from './aaveToMorphoDebtMigrationWithSwapExactOut.js';
import { buildTrivialFlashloanRepay } from './flashloanRepay.js';
import { buildManualRelayContinuation } from './manualRelayContinuation.js';

export const STAGED_EXAMPLES: Record<string, () => ComposeCompileRequest> = {
  'debt-rebalance': () =>
    buildAaveDebtRebalanceExactOut({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      debtAmount: '1000000000',
      newDebtBorrowAmount: '965000000',
    }).request,
  'debt-migration-swap-exact-out': () =>
    buildAaveToMorphoDebtMigrationWithSwapExactOut({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      debtAmount: '1000000000',
      morphoBorrowAmount: '975000000',
    }).request,
  'flashloan-repay': () =>
    buildTrivialFlashloanRepay({
      owner: OWNER,
      amount: '10000000000',
      fee: '5000000',
    }).request,
  'debt-migration': () =>
    buildAaveToMorphoDebtMigration({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      debtAmount: '1000000000',
      debtFlashloanFee: '500000',
    }).request,
  'debt-migration-swap': () =>
    buildAaveToMorphoDebtMigrationWithSwap({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      debtAmount: '1000000000',
      morphoBorrowAmount: '1100000000',
    }).request,
  'manual-relay-continuation': () =>
    buildManualRelayContinuation({
      owner: OWNER,
      recipient: RECIPIENT,
      amount: '1000000',
      minAmountOut: '990000',
      expiresAtMs: 1900000000000,
    }).request,
};
