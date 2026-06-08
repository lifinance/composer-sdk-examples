import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk } from '@lifi/composer-sdk';
import type { Address } from '@lifi/composer-sdk';

import { BASE_URL } from './config.js';

// Aave v3 incentives contracts on Ethereum mainnet.
const REWARDS_CONTROLLER = '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb';
const AAVE = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
// Receipt-token positions the proxy holds and that accrue AAVE rewards.
const A_ETH_USDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';
const VDEBT_USDC = '0x72E95b8931767C79bA4EeE721354d6E99a61D004';

export interface AaveClaimRewardsInput {
  readonly owner: Address;
  readonly recipient: Address;
}

/**
 * Claim accrued AAVE rewards from a set of Aave v3 receipt-token positions,
 * then forward the claimed amount to a recipient.
 *
 * The op surfaces the claimed AAVE as a tracked resource (`claimed`) so
 * downstream nodes can spend or forward it. With no `amount` configured,
 * Aave claims the full accrued balance (MaxUint256 sentinel).
 *
 * Demonstrates:
 * - `aave.claimRewards` against multiple aToken/vDebt positions.
 * - Routing the `claimed` resource output into `core.transfer`.
 * - The `claimedAmount` handle for assertions or downstream arithmetic.
 */
export const buildAaveClaimRewards = ({
  owner,
  recipient,
}: AaveClaimRewardsInput): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'aave-claim-rewards',
    inputs: {
      recipient: 'address',
    },
  });

  const claimOut = builder.aave.claimRewards('claim', {
    bind: {},
    config: {
      rewardsController: REWARDS_CONTROLLER,
      assets: [A_ETH_USDC, VDEBT_USDC],
      reward: AAVE,
      // amount omitted → claim full accrued balance.
      // to omitted → rewards land on the proxy (executionAddress).
    },
  });

  // Forward the claimed AAVE to the requested recipient.
  builder.core.transfer('forward-rewards', {
    bind: {
      amount: claimOut.claimed,
      recipient: builder.inputs.recipient,
    },
    config: {},
  });

  const flow = builder.build();

  const request = sdk.request(flow, {
    simulationPolicy: 'strict',
    signer: owner,
    inputs: {
      recipient,
    },
    sweepTo: builder.context.sender,
  });

  return { flow, request };
};
