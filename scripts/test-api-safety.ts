import assert from 'node:assert/strict';
import worker from '../workers/agent-api/src/index';
import { runAgentShipGate } from '../server/agentShipGate';
import { XLAYER_USDC } from '../server/x402';
import { FIXTURE_CONTRACT } from './fixtures/observedFacts';

const baseEnv = {
  X402_PAY_TO: '0x1111111111111111111111111111111111111111',
  X402_NETWORK: 'xlayer',
  X402_PRICE_USD: '0.01',
  X402_ASSET: XLAYER_USDC,
  X402_DEV_BYPASS: '0',
};

async function call(
  path: string,
  init: RequestInit,
  env = baseEnv,
): Promise<Response> {
  return worker.fetch(new Request(`https://shomer.test${path}`, init), env);
}

let response = await call('/api/agent/verify', { method: 'GET' });
assert.equal(response.status, 405);

response = await call('/api/agent/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{broken',
});
assert.equal(response.status, 400);
assert.equal((await response.json() as { error: string }).error, 'invalid_json');

response = await call('/api/agent/verify', {
  method: 'POST',
  headers: { 'content-type': 'text/plain' },
  body: '{}',
});
assert.equal(response.status, 415);

response = await call('/api/agent/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ network: 'ethereum', contractAddress: FIXTURE_CONTRACT }),
});
assert.equal(response.status, 400);
assert.equal((await response.json() as { error: string }).error, 'invalid_network');

response = await call('/api/agent/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ network: 'mainnet', contractAddress: '0x1234' }),
});
assert.equal(response.status, 400);
assert.equal((await response.json() as { error: string }).error, 'invalid_address');

response = await call('/api/agent/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    network: 'mainnet',
    contractAddress: FIXTURE_CONTRACT,
    padding: 'x'.repeat(70_000),
  }),
});
assert.equal(response.status, 413);
assert.equal((await response.json() as { error: string }).error, 'payload_too_large');

// Paid requests must be validated before payment verification/settlement. A
// malformed replay must return 400, not reach the facilitator and return 402.
response = await call('/api/agent/verify/paid', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'PAYMENT-SIGNATURE': 'payment-looking-but-invalid',
  },
  body: '{broken',
});
assert.equal(response.status, 400);
assert.equal((await response.json() as { error: string }).error, 'invalid_json');

response = await call(
  '/api/agent/verify/paid',
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'PAYMENT-SIGNATURE': 'local-test-proof',
    },
    body: JSON.stringify({
      network: 'mainnet',
      contractAddress: FIXTURE_CONTRACT,
      relatedContracts: Array.from({ length: 9 }, (_, i) =>
        `0x${String(i + 1).padStart(40, '0')}`,
      ),
    }),
  },
  { ...baseEnv, X402_DEV_BYPASS: '1' },
);
assert.equal(response.status, 400);
assert.equal(
  (await response.json() as { error: string }).error,
  'too_many_related_contracts',
);

// A2MCP CLIs may transport structured --param values as JSON strings. The
// endpoint normalizes those back into the declared body objects before replay.
response = await call('/api/agent/verify/paid', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    network: 'mainnet',
    contractAddress: FIXTURE_CONTRACT,
    policy: JSON.stringify({ upgradeable: false }),
    reviewedArtifact: JSON.stringify({
      runtimeCodeHash: `0x${'ab'.repeat(32)}`,
    }),
  }),
});
assert.equal(response.status, 402);

const upstreamFailure = await runAgentShipGate(
  { network: 'mainnet', contractAddress: FIXTURE_CONTRACT },
  { readFacts: async () => { throw new Error('RPC unavailable'); } },
);
assert.equal(upstreamFailure.status, 502);
assert.equal(upstreamFailure.body.error, 'read_failed');

console.log('API safety and failure-mode fixtures passed.');
