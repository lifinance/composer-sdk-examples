import type { SimulateRequest } from '@lifi/compose-spec';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

/**
 * Build a representative `POST /simulate` request: a USDC transfer of 1 USDC
 * (1_000_000 base units at 6 decimals) from `SENDER` to `RECIPIENT` on chain 1.
 *
 * Demonstrates:
 * - A pre-encoded `transfer(address,uint256)` calldata literal (`data`)
 * - Funding the sender with an `Erc20Balance` requirement so the transfer can
 *   succeed in simulation (`bigint` amounts are accepted and serialised)
 * - Watching both the sender's and recipient's USDC balance via `trackedBalances`
 *
 * Pure: returns a plain {@link SimulateRequest}, performs no network I/O. Pass
 * it to `sdk.client.simulate(...)` / `sdk.simulate(...)` to run it.
 */
export const buildSimulateRawTransactionExample = (): SimulateRequest => ({
  chainId: 1,
  from: SENDER,
  to: USDC,
  // transfer(RECIPIENT, 1_000_000)
  data: '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000f4240',
  value: 0n,
  requirements: [
    {
      type: 'Erc20Balance',
      wallet: SENDER,
      token: USDC,
      balance: 1_000_000n,
    },
  ],
  trackedBalances: [
    { token: USDC, owner: SENDER },
    { token: USDC, owner: RECIPIENT },
  ],
});
