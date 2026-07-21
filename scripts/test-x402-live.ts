/**
 * Live challenge is free. A paid replay only runs when the caller supplies an
 * authorization header that they obtained after an explicit payment approval.
 * This script never signs or initiates a payment.
 */
import assert from 'node:assert/strict';

const endpoint =
  process.env.SHOMER_PAID_ENDPOINT ??
  'https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid';
const body = JSON.stringify({
  network: 'mainnet',
  contractAddress:
    process.env.SHOMER_LIVE_CONTRACT ??
    '0x857bdb4dc9a571b0b1136db18f573764eb424e38',
});

const challenge = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});
assert.equal(challenge.status, 402);
const required = challenge.headers.get('PAYMENT-REQUIRED');
assert.ok(required, 'live endpoint must return PAYMENT-REQUIRED');
const decoded = JSON.parse(Buffer.from(required!, 'base64').toString('utf8')) as {
  accepts?: unknown[];
};
assert.ok(Array.isArray(decoded.accepts) && decoded.accepts.length > 0);
console.log('ok: live paid endpoint returned a decodable payment challenge');

const authorization = process.env.X402_AUTHORIZATION_HEADER?.trim();
if (!authorization) {
  console.log(
    'skip: paid replay requires X402_AUTHORIZATION_HEADER from a separately confirmed OKX Agent Payments Protocol payment.',
  );
  process.exit(0);
}

const replay = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'PAYMENT-SIGNATURE': authorization,
  },
  body,
});
assert.equal(replay.status, 200);
const result = await replay.json() as {
  ok?: boolean;
  payment?: { settled?: boolean };
  deepVerification?: unknown;
};
assert.equal(result.ok, true);
assert.equal(result.payment?.settled, true);
assert.ok(result.deepVerification);
console.log('ok: paid replay settled and returned Deep Verification');
