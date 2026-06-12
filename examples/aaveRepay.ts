import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Aave v3 contracts on Ethereum mainnet.
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
// Aave v3 aEthUSDC receipt token and variable-debt WETH token.
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';
const VDEBT_WETH = '0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE';

export interface AaveRepayInput {
  readonly owner: Address;
  /** USDC supplied as collateral so the proxy can borrow WETH (6 dp). */
  readonly collateralAmount: `${bigint}`;
  /** WETH borrowed against the collateral (18 dp). */
  readonly borrowAmount: `${bigint}`;
  /**
   * WETH deposited to repay the debt (18 dp). Must exceed `borrowAmount`:
   * Aave's scaled-balance rounding can leave the debt 1 wei above the
   * borrowed amount, so the `max`-mode repay needs a little headroom.
   */
  readonly repayAmount: `${bigint}`;
}

/**
 * Supply USDC to Aave v3, borrow WETH against it, then repay the WETH borrow —
 * a self-contained supply → borrow → repay round trip.
 *
 * Demonstrates:
 * - `lifi.zap` to supply USDC into Aave (USDC → aEthUSDC routing edge)
 * - `aave.borrow` to mint variable WETH debt against the supplied collateral
 * - `aave.repay` (mode: 'max') funded by a fresh WETH deposit, clearing the
 *   debt exactly so the collateral is freed
 * - `sweepTo` to return all leftover proxy-held resources (the freed
 *   aEthUSDC collateral, the borrowed WETH, and the repay residual) to the
 *   sender
 */
export const buildAaveRepay = ({
  owner,
  collateralAmount,
  borrowAmount,
  repayAmount,
}: AaveRepayInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'aave-repay-weth',
    inputs: {
      collateralIn: resources.erc20(USDC, 1),
      repayIn: resources.erc20(WETH, 1),
    },
  });

  // Supply USDC as collateral (USDC → aEthUSDC) so the proxy can borrow.
  builder.lifi.zap('supply', {
    bind: { amountIn: builder.inputs.collateralIn },
    config: { resourceOut: resources.erc20(A_ETH_USDC, 1) },
  });

  // Borrow WETH against the collateral; the borrowed WETH stays on the
  // proxy as a terminal resource and is swept back to the sender.
  builder.aave.borrow('borrow', {
    bind: {},
    config: {
      pool: AAVE_V3_POOL,
      asset: WETH,
      variableDebtToken: VDEBT_WETH,
      amount: borrowAmount,
    },
  });

  // Repay the just-opened WETH debt from the deposited WETH. mode 'max'
  // passes type(uint256).max so Aave clamps to the outstanding debt exactly
  // — required to clear the borrow flag and free the collateral for sweeping.
  builder.aave.repay('repay', {
    bind: {
      assetIn: builder.inputs.repayIn,
      onBehalfOf: builder.context.executionAddress,
    },
    config: {
      pool: AAVE_V3_POOL,
      mode: 'max',
    },
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      collateralIn: materialisers.directDeposit({ amount: collateralAmount }),
      repayIn: materialisers.directDeposit({ amount: repayAmount }),
    },
    // Once the debt is cleared, sweep the freed aEthUSDC collateral, the
    // borrowed WETH, and the repay residual back to the sender.
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
