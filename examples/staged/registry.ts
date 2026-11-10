// Registry of the flashloan examples, loaded by examples/run.ts only with
// --staged, through a non-literal dynamic import. `lifi.flashloanRepay` and
// `materialisers.flashloan` exist only in the staging SDK build, so
// tsconfig.json excludes this directory and tsconfig.staged.json type-checks
// it. Install the staging pair first (`npm run staged:install`); README.md
// ("Flashloan examples") lists what a live compile needs.
import type { ComposeCompileRequest } from '@lifi/compose-spec';

import { OWNER } from '../config.js';

import { buildAaveDebtRebalanceExactOut } from './aaveDebtRebalanceExactOut.js';
import { buildAaveToMorphoDebtMigration } from './aaveToMorphoDebtMigration.js';
import { buildAaveToMorphoDebtMigrationWithSwap } from './aaveToMorphoDebtMigrationWithSwap.js';
import { buildAaveToMorphoDebtMigrationWithSwapExactOut } from './aaveToMorphoDebtMigrationWithSwapExactOut.js';
import { buildTrivialFlashloanRepay } from './flashloanRepay.js';

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
    }).request,
  'debt-migration': () =>
    buildAaveToMorphoDebtMigration({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      debtAmount: '1000000000',
    }).request,
  'debt-migration-swap': () =>
    buildAaveToMorphoDebtMigrationWithSwap({
      owner: OWNER,
      collateralAmount: '1000000000000000000',
      debtAmount: '1000000000',
      morphoBorrowAmount: '1100000000',
    }).request,
};
