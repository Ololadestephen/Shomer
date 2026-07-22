import assert from 'node:assert/strict';
import worker from '../workers/agent-api/src/index';
import {
  buildPaymentRequired,
  XLAYER_USDC,
  verifyPayment,
  type X402Config,
} from '../server/x402';
import type { ReceiptDatabase, ReceiptStatement } from '../server/paymentReceipts';

const PAY_TO = '0x1111111111111111111111111111111111111111';
const cfg: X402Config = {
  payTo: PAY_TO,
  priceUsd: '0.01',
  network: 'eip155:196',
  asset: XLAYER_USDC,
  assetName: 'USD Coin',
  assetVersion: '2',
};
const env = {
  X402_PAY_TO: PAY_TO,
  X402_PRICE_USD: '0.01',
  X402_NETWORK: 'xlayer',
  X402_ASSET: XLAYER_USDC,
  X402_ASSET_NAME: 'USD Coin',
  X402_ASSET_VERSION: '2',
  X402_DEV_BYPASS: '0',
  SHOMER_RECEIPTS: {
    prepare(): ReceiptStatement {
      return {
        bind() { return this; },
        async first() { return null; },
        async run() { return {}; },
      };
    },
  } satisfies ReceiptDatabase,
};

// Ensure a developer shell setting cannot turn this deterministic test into a
// network call.
delete process.env.X402_FACILITATOR_URL;

const requestBody = JSON.stringify({
  network: 'mainnet',
  contractAddress: '0x2222222222222222222222222222222222222222',
});

const challenge = await worker.fetch(
  new Request('https://shomer.test/api/agent/verify/paid', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody,
  }),
  env,
);
assert.equal(challenge.status, 402);
const encoded = challenge.headers.get('PAYMENT-REQUIRED');
assert.ok(encoded, 'PAYMENT-REQUIRED header is present');
const decoded = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8')) as {
  accepts: Array<Record<string, unknown>>;
  outputSchema?: {
    method?: string;
    bodyType?: string;
    input?: Record<string, { carrier?: string; required?: boolean }>;
  };
  extensions?: { bazaar?: unknown };
};
assert.equal(decoded.accepts[0]?.network, 'eip155:196');
assert.equal(decoded.accepts[0]?.amount, '10000');
assert.equal(decoded.accepts[0]?.asset, XLAYER_USDC);
assert.equal(decoded.accepts[0]?.payTo, PAY_TO);
assert.equal(decoded.outputSchema?.method, 'POST');
assert.equal(decoded.outputSchema?.bodyType, 'json');
assert.equal(decoded.outputSchema?.input?.contractAddress?.carrier, 'body');
assert.equal(decoded.outputSchema?.input?.contractAddress?.required, true);
assert.equal(decoded.outputSchema?.input?.network?.carrier, 'body');
assert.equal(decoded.outputSchema?.input?.reviewedRuntimeCodeHash?.carrier, 'body');
assert.ok(decoded.extensions?.bazaar);
console.log('ok: paid route returns a valid X Layer payment challenge');

const fakeProof = await worker.fetch(
  new Request('https://shomer.test/api/agent/verify/paid', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'PAYMENT-SIGNATURE': Buffer.from('{"fake":true}').toString('base64'),
    },
    body: requestBody,
  }),
  env,
);
assert.equal(fakeProof.status, 402);
assert.equal((await fakeProof.json() as { error: string }).error, 'payment_invalid');
console.log('ok: a payment-looking header cannot unlock paid verification');

const requirements = buildPaymentRequired(
  { ...cfg, facilitatorUrl: 'https://facilitator.test' },
  'https://shomer.test/api/agent/verify/paid',
  'fixture',
);
const facilitatorCalls: string[] = [];
const accepted = await verifyPayment(
  { ...cfg, facilitatorUrl: 'https://facilitator.test' },
  Buffer.from(JSON.stringify({ accepted: decoded.accepts[0], payload: {} })).toString('base64'),
  requirements,
  {
    fetch: async (input) => {
      const url = String(input);
      facilitatorCalls.push(url);
      return new Response(
        JSON.stringify(
          url.endsWith('/verify')
            ? { isValid: true }
            : { success: true, transaction: '0xsettled' },
        ),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  },
);
assert.equal(accepted.ok, true);
assert.equal(accepted.mode, 'facilitator_settled');
assert.equal(facilitatorCalls.length, 2);
assert.ok(accepted.responseHeader);

const ambiguous = await verifyPayment(
  { ...cfg, facilitatorUrl: 'https://facilitator.test' },
  Buffer.from(JSON.stringify({ accepted: decoded.accepts[0], payload: {} })).toString('base64'),
  requirements,
  {
    fetch: async () => new Response('{}', { status: 200 }),
  },
);
assert.equal(ambiguous.ok, false);
console.log('ok: facilitator must explicitly confirm validity');

const unsettled = await verifyPayment(
  { ...cfg, facilitatorUrl: 'https://facilitator.test' },
  Buffer.from(JSON.stringify({ accepted: decoded.accepts[0], payload: {} })).toString('base64'),
  requirements,
  {
    fetch: async (input) =>
      new Response(
        JSON.stringify(
          String(input).endsWith('/verify') ? { isValid: true } : {},
        ),
        { status: 200 },
      ),
  },
);
assert.equal(unsettled.ok, false);
assert.equal(unsettled.mode, 'facilitator_settle');
console.log('ok: verified but unconfirmed settlement remains locked');

const phasedCalls: string[] = [];
const phasedFetch: typeof fetch = async (input) => {
  const url = String(input);
  phasedCalls.push(url);
  return new Response(
    JSON.stringify(
      url.endsWith('/verify')
        ? { isValid: true }
        : { success: true, transaction: '0xsettled-after-fulfillment' },
    ),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
const authorization = await verifyPayment(
  { ...cfg, facilitatorUrl: 'https://facilitator.test' },
  Buffer.from(JSON.stringify({ accepted: decoded.accepts[0], payload: {} })).toString('base64'),
  requirements,
  { fetch: phasedFetch, phase: 'verify' },
);
assert.equal(authorization.ok, true);
assert.equal(authorization.mode, 'facilitator_verified');
assert.deepEqual(phasedCalls, ['https://facilitator.test/verify']);

phasedCalls.length = 0;
const postFulfillmentSettlement = await verifyPayment(
  { ...cfg, facilitatorUrl: 'https://facilitator.test' },
  Buffer.from(JSON.stringify({ accepted: decoded.accepts[0], payload: {} })).toString('base64'),
  requirements,
  { fetch: phasedFetch, phase: 'settle' },
);
assert.equal(postFulfillmentSettlement.ok, true);
assert.equal(postFulfillmentSettlement.mode, 'facilitator_settled');
assert.deepEqual(phasedCalls, ['https://facilitator.test/settle']);
console.log('ok: authorization and settlement can bracket successful fulfillment');

const officialCalls: Array<{ url: string; init?: RequestInit }> = [];
const official = await verifyPayment(
  {
    ...cfg,
    facilitatorUrl: 'https://web3.okx.com/api/v6/pay/x402',
    okxApiKey: 'fixture-api-key',
    okxSecretKey: 'fixture-secret-key',
    okxPassphrase: 'fixture-passphrase',
  },
  Buffer.from(JSON.stringify({ accepted: decoded.accepts[0], payload: {} })).toString('base64'),
  requirements,
  {
    fetch: async (input, init) => {
      const url = String(input);
      officialCalls.push({ url, init });
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('OK-ACCESS-KEY'), 'fixture-api-key');
      assert.equal(headers.get('OK-ACCESS-PASSPHRASE'), 'fixture-passphrase');
      assert.ok(headers.get('OK-ACCESS-SIGN'));
      assert.ok(headers.get('OK-ACCESS-TIMESTAMP'));
      if (url.endsWith('/settle')) {
        assert.equal((JSON.parse(String(init?.body)) as { syncSettle?: boolean }).syncSettle, true);
      }
      return new Response(
        JSON.stringify({
          code: '0',
          data: url.endsWith('/verify')
            ? { isValid: true, payer: '0x3333333333333333333333333333333333333333' }
            : {
                success: true,
                transaction: '0xsettled',
                network: 'eip155:196',
                status: 'success',
              },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  },
);
assert.equal(official.ok, true);
assert.equal(official.mode, 'facilitator_settled');
assert.equal(officialCalls.length, 2);
console.log('ok: official OKX facilitator authentication and wrapped responses are supported');

let missingCredentialsFetchCalled = false;
const missingCredentials = await verifyPayment(
  { ...cfg, facilitatorUrl: 'https://web3.okx.com/api/v6/pay/x402' },
  Buffer.from(JSON.stringify({ accepted: decoded.accepts[0], payload: {} })).toString('base64'),
  requirements,
  {
    fetch: async () => {
      missingCredentialsFetchCalled = true;
      return new Response('{}');
    },
  },
);
assert.equal(missingCredentials.ok, false);
assert.equal(missingCredentials.mode, 'facilitator');
assert.match(missingCredentials.detail ?? '', /OKX_API_KEY/);
assert.equal(missingCredentialsFetchCalled, false);
console.log('ok: official OKX facilitator fails closed when credentials are incomplete');

console.log('\nx402 deterministic fixtures passed.');
