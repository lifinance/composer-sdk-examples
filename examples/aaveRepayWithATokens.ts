import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Aave v3 contracts on Ethereum mainnet.
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// Aave v3 aEthUSDC receipt token and variable-debt USDC token.
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';
const VDEBT_USDC = '0x72E95b8931767C79bA4EeE721354d6E99a61D004';

export interface AaveRepayWithATokensInput {
  readonly owner: Address;
  /** USDC supplied as collateral, minting the aUSDC burned by the repay (6 dp). */
  readonly collateralAmount: `${bigint}`;
  /** USDC borrowed against the collateral, then repaid by this flow (6 dp). */
  readonly borrowAmount: `${bigint}`;
}

/**
 * Supply USDC to Aave v3, borrow USDC against it, then repay the debt by
 * burning the supplied aUSDC directly — no fresh asset transfer required.
 *
 * Demonstrates:
 * - `lifi.zap` to supply USDC into Aave (USDC → aEthUSDC routing edge)
 * - `aave.borrow` to mint variable USDC debt against the supplied collateral
 * - `aave.repayWithATokens` to clear the debt by burning the aUSDC collateral
 * - `sweepTo` to return the borrowed USDC and the unburned aUSDC to the
 *   sender once the debt is cleared
 */
export const buildAaveRepayWithATokens = ({
  owner,
  collateralAmount,
  borrowAmount,
}: AaveRepayWithATokensInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'aave-repay-with-atokens',
    inputs: {
      collateralIn: resources.erc20(USDC, 1),
    },
  });

  // Supply USDC as collateral (USDC → aEthUSDC); the aUSDC is burned below.
  const supplyOut = builder.lifi.zap('supply', {
    bind: { amountIn: builder.inputs.collateralIn },
    config: { resourceOut: resources.erc20(A_ETH_USDC, 1) },
  });

  // Borrow USDC against the supplied collateral to open a debt position.
  builder.aave.borrow('borrow', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL,
      asset: USDC,
      variableDebtToken: VDEBT_USDC,
      amount: borrowAmount,
    },
  });

  // Repay the USDC debt by burning the aUSDC collateral directly. The aToken
  // input exceeds the debt, so Aave clamps the payback to the outstanding
  // debt exactly — clearing the borrow flag and freeing the rest for the sweep.
  builder.aave.repayWithATokens('repay-atokens', {
    bind: { aTokenIn: supplyOut.amountOut },
    config: {
      pool: AAVE_V3_POOL,
      asset: USDC,
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      collateralIn: materialisers.directDeposit({ amount: collateralAmount }),
    },
    // Once the debt is cleared, sweep the borrowed USDC and the unburned
    // aUSDC collateral back to the sender.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
