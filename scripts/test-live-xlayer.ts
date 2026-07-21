/**
 * Opt-in live X Layer matrix. This is deliberately excluded from CI because
 * RPC/explorer availability is external and latency is variable.
 */
import assert from 'node:assert/strict';
import { runAgentVerify } from '../server/agentVerify';

const cases = [
  {
    name: 'Multicall3 infrastructure contract',
    address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  {
    name: 'BabyMove token',
    address: '0x857bdb4dc9a571b0b1136db18f573764eb424e38',
  },
  {
    name: 'USD₮0 payment-token contract',
    address: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
  },
];

const warnMs = Number(process.env.LIVE_XLAYER_WARN_MS ?? 20_000);
const failMs = Number(process.env.LIVE_XLAYER_FAIL_MS ?? 60_000);
let failed = 0;

for (const sample of cases) {
  const started = performance.now();
  const result = await runAgentVerify(
    {
      network: 'mainnet',
      contractAddress: sample.address,
      options: { undeclaredObserved: 'out_of_scope' },
    },
    'free',
  );
  const elapsedMs = Math.round(performance.now() - started);
  try {
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.chainId, 196);
    assert.equal(result.body.network, 'mainnet');
    assert.equal(result.body.facts.hasCode, true);
    assert.ok(result.body.blockNumber > 0);
    assert.notEqual(
      result.body.verdict,
      'policy_matched',
      'no-policy live probes must never return Policy Matched',
    );
    assert.ok(elapsedMs <= failMs, `${sample.name} exceeded ${failMs} ms`);
    const latency = elapsedMs > warnMs ? 'WARN' : 'OK';
    console.log(
      `${latency} ${sample.name}: ${elapsedMs} ms · block ${result.body.blockNumber} · ${result.body.verdict}`,
    );
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${sample.name}:`, error);
  }
}

if (failed > 0) process.exitCode = 1;
else console.log('\nLive X Layer matrix passed.');
