// Local contract checks use mocked HTTP responses, not a live compile.
import { createComposeSdk, isComposeError } from '@lifi/composer-sdk';
import { buildSwapAndZapExample } from '../examples/swapAndZap.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);
};

let fetches = 0;
globalThis.fetch = (async () => {
  fetches += 1;
  throw new Error('network fetch is not allowed in the local contract test');
}) as typeof fetch;

const built = buildSwapAndZapExample();
check('build does not call fetch', fetches === 0, `fetches=${fetches}`);

const request = built.request;
check('compile request has flow and run', 'flow' in request && 'run' in request);
check('flow version is 1', request.flow.version === 1, String(request.flow.version));
const ops = request.flow.nodes.map((node) => node.op);
check('swap node', ops.includes('lifi.swap'), ops.join(','));
check('zap node', ops.includes('lifi.zap'), ops.join(','));
const amountIn = request.run.inputs['amountIn'] as { kind?: string; amount?: string } | undefined;
check('amountIn is directDeposit', amountIn?.kind === 'directDeposit', String(amountIn?.kind));
check('amountIn amount is the example value', amountIn?.amount === '1000000000000000000');

const version = '0.13.0';
const successBody = {
  data: {
    outputs: {
      'swap.amountOut': { role: 'consumed', amount: { estimate: { value: '1000' } } },
      'zap.amountOut': {
        role: 'terminal',
        amount: { estimate: { value: '900' }, minimum: { value: '800' } },
      },
    },
    userProxy: '0x2222222222222222222222222222222222222222',
    transactionRequest: {
      to: '0x3333333333333333333333333333333333333333',
      chainId: 8453,
      data: '0x1234',
      value: '0',
      gasLimit: '21000',
    },
    approvals: [
      {
        token: '0x4200000000000000000000000000000000000006',
        spender: '0x2222222222222222222222222222222222222222',
        amount: '1000000000000000000',
        transactionRequest: {
          to: '0x4200000000000000000000000000000000000006',
          data: '0xabcd',
          value: '0',
        },
      },
    ],
  },
};
const partialBody = {
  data: {
    outputs: successBody.data.outputs,
    userProxy: successBody.data.userProxy,
    transactionRequest: {
      to: successBody.data.transactionRequest.to,
      chainId: 8453,
      data: '0x1234',
      value: '0',
    },
    simulationRevert: { code: 3, rawErrorBytes: '0xdead' },
  },
  error: { kind: 'simulation_reverted', message: 'pool reverted' },
};

let postedBody = '';
let sentHeaders: Headers;
const mockFetch = (status: number, body: unknown, serverVersion = version) =>
  (async (_url: string, init?: RequestInit) => {
    postedBody = String(init?.body ?? '');
    sentHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-lifi-composer-version': serverVersion },
    });
  }) as typeof fetch;

const compileWith = (status: number, body: unknown, serverVersion = version) => {
  const sdk = createComposeSdk({
    baseUrl: 'https://composer.li.quest',
    apiKey: 'local-test-placeholder',
    fetch: mockFetch(status, body, serverVersion),
  });
  return sdk.client.compile(request);
};

const main = async () => {
  const success = await compileWith(200, successBody);
  const posted = JSON.parse(postedBody) as { flow?: { version?: number }; run?: unknown };
  check('posted body is the compile request', posted.flow?.version === 1 && posted.run != null);
  check('API key header', sentHeaders!.get('x-lifi-api-key') === 'local-test-placeholder');
  check('no API key in body', !postedBody.includes('local-test-placeholder'));
  check('success status', success.status === 'success', success.status);
  check('success decodes estimate', success.outputs['zap.amountOut']?.amount.estimate?.value === 900n);
  check('success has one approval', success.approvals?.length === 1, String(success.approvals?.length));
  check(
    'success gasLimit is the server string',
    success.transactionRequest?.gasLimit === '21000',
    String(success.transactionRequest?.gasLimit),
  );

const partial = await compileWith(206, partialBody);
check('partial status', partial.status === 'partial', partial.status);
check('partial has no gasLimit', partial.transactionRequest?.gasLimit === undefined);
check('partial revert code', partial.status === 'partial' && partial.simulationRevert.code === 3);

let unauthenticated = false;
try {
  await compileWith(401, { error: { kind: 'unauthenticated', message: 'missing key' } });
} catch (err) {
  unauthenticated = isComposeError(err) && err.code === 'UNAUTHENTICATED';
}
check('401 maps to UNAUTHENTICATED', unauthenticated);

let outdated = false;
try {
  await compileWith(200, successBody, '0.6.0');
} catch (err) {
  outdated = isComposeError(err) && err.kind === 'server_outdated';
}
check('0.6.0 server header is rejected', outdated);

if (failures.length > 0) {
  console.error(`FAILURES ${failures.length}`);
  process.exit(1);
}
console.log('ALL_PASS');
};

main();
