import type { ComposeCompileRequest, Flow } from '@lifi/compose-spec';

import { createComposeSdk, materialisers, resources } from '@lifi/composer-sdk';

import { BASE_URL, OWNER } from './config.js';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/**
 * Swap WETH to USDC with `simulationPolicy: 'allow-revert'`.
 *
 * Demonstrates:
 * - Opting into partial results when simulation detects a revert
 * - The `ComposeCompileResult` discriminated union (`status: 'success' | 'partial'`)
 * - Inspecting `simulationRevert` diagnostics on a partial result
 * - Using `checkOnChainAllowances` to filter already-sufficient approvals
 *
 * When the compiled transaction reverts in simulation:
 * - Default (`simulationPolicy: 'strict'`): the API returns HTTP 422 and the SDK throws.
 * - With `simulationPolicy: 'allow-revert'`: the API returns HTTP 206 and the SDK returns
 *   a partial result containing the transaction (without `gasLimit`) and revert diagnostics.
 *   The caller can inspect the revert reason and decide whether to submit anyway.
 */
export const buildSwapWithAllowRevertExample = (): {
  flow: Flow;
  request: ComposeCompileRequest;
} => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    name: 'swap-weth-to-usdc-allow-revert',
    inputs: {
      amountIn: resources.erc20(WETH, 1),
    },
  });

  builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: {
      resourceOut: resources.erc20(USDC, 1),
      slippage: 0.03,
    },
  });

  const flow = builder.build();

  // Pass simulationPolicy and checkOnChainAllowances in the run inputs.
  // 'allow-revert' tells the backend to return a partial result instead of
  // a 422 error when the transaction reverts in simulation.
  const request = sdk.request(flow, {
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({
        amount: '1000000000000000000',
      }),
    },
    sweepTo: builder.context.sender,
    simulationPolicy: 'allow-revert',
    checkOnChainAllowances: true,
  });

  return { flow, request };
};

/**
 * Shows how to handle the `ComposeCompileResult` discriminated union
 * returned by `sdk.client.compile()`.
 *
 * This function is illustrative — it cannot run without a live backend,
 * but demonstrates the branching pattern callers should use.
 */
export const handleCompileResult = async (): Promise<void> => {
  const sdk = createComposeSdk({ baseUrl: BASE_URL });

  const builder = sdk.flow(1, {
    inputs: { amountIn: resources.erc20(WETH, 1) },
  });

  builder.lifi.swap('swap', {
    bind: { amountIn: builder.inputs.amountIn },
    config: { resourceOut: resources.erc20(USDC, 1), slippage: 0.03 },
  });

  const result = await builder.compile({
    signer: OWNER,
    inputs: {
      amountIn: materialisers.directDeposit({ amount: '1000000000000000000' }),
    },
    simulationPolicy: 'allow-revert',
  });

  if (result.status === 'success') {
    // Full success — transactionRequest includes gasLimit.
    const { transactionRequest, userProxy, producedResources } = result;
    void transactionRequest;
    void userProxy;
    void producedResources;
    return;
  }

  // Partial result — simulation reverted but a transaction is still available.
  // transactionRequest omits gasLimit; the caller must estimate gas themselves.
  const { transactionRequest, simulationRevert, error } = result;
  void transactionRequest;

  // Inspect the revert reason.
  void simulationRevert.code;
  void simulationRevert.rawErrorBytes;
  if (simulationRevert.decodeResult?.errorCandidates) {
    for (const candidate of simulationRevert.decodeResult.errorCandidates) {
      void candidate.decodedErrorSignature;
      void candidate.decodedParams;
    }
  }

  // The error envelope from the server.
  void error.kind; // e.g. 'simulation_revert'
  void error.message; // human-readable description
};
