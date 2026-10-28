// Registry loaded by examples/run.ts only with --staged, through a non-literal
// dynamic import. tsconfig.json excludes this directory. The pinned 0.13.0 SDK
// does not generate lifi.flashloanRepay. The npm staging tag (0.4.0-staging.1)
// is not compatible with the production 0.13 minor version. Do not install it
// over the pinned pair or compile these examples against production.
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
};
