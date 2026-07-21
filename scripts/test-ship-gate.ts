/** Deterministic ship-gate invariants. No RPC or explorer access. */
import assert from 'node:assert/strict';
import {
  hasExplicitApprovedPolicy,
  runAgentShipGate,
} from '../server/agentShipGate';
import { runAgentVerify } from '../server/agentVerify';
import {
  FIXTURE_CONTRACT,
  FIXTURE_OWNER,
  makeObservedFacts,
} from './fixtures/observedFacts';

const WRONG_OWNER = '0x3333333333333333333333333333333333333333';

function ok(message: string): void {
  console.log(`ok: ${message}`);
}

assert.equal(
  hasExplicitApprovedPolicy({ owner: FIXTURE_OWNER }),
  false,
  'approvedPolicy must not be optional',
);
ok('substantive fields without approvedPolicy:true are not approved');

assert.equal(
  hasExplicitApprovedPolicy({ owner: FIXTURE_OWNER }, true),
  true,
);
assert.equal(hasExplicitApprovedPolicy({ upgradeable: false }, true), false);
assert.equal(hasExplicitApprovedPolicy(undefined, true), false);
ok('approval requires the flag and a substantive rule');

const noPolicy = await runAgentVerify(
  { network: 'mainnet', contractAddress: FIXTURE_CONTRACT },
  'free',
  { facts: makeObservedFacts() },
);
assert.equal(noPolicy.status, 200);
assert.equal(noPolicy.body.verdict, 'review_required');
for (const key of [
  'upgrade_authority',
  'timelock_delay',
  'implementation_hash',
  'initializer_sealed',
]) {
  const result = noPolicy.body.results.find((row) => row.checkKey === key);
  assert.equal(result?.status, 'skipped', `${key} must be skipped`);
  assert.equal(result?.skipReason, 'out_of_scope');
}
ok('no-policy verify cannot turn manifest defaults into green checks');

async function gate(
  input: Parameters<typeof runAgentShipGate>[0],
  facts = makeObservedFacts(),
) {
  let reads = 0;
  const result = await runAgentShipGate(input, {
    readFacts: async () => {
      reads += 1;
      return facts;
    },
  });
  assert.equal(reads, 1, 'ship-gate must call readFacts once');
  assert.equal(result.body.chainReads, 1);
  return result;
}

const blocked = await gate({
  network: 'mainnet',
  contractAddress: FIXTURE_CONTRACT,
  policy: { upgradeable: false, owner: WRONG_OWNER },
  approvedPolicy: true,
});
assert.equal(blocked.body.verdict, 'blocked');
assert.equal((blocked.body.shipGate as { allowed: boolean }).allowed, false);
ok('wrong owner is Blocked and never allowed');

const matchedButUnapproved = await gate({
  network: 'mainnet',
  contractAddress: FIXTURE_CONTRACT,
  policy: { upgradeable: false, owner: FIXTURE_OWNER },
});
assert.equal(matchedButUnapproved.body.verdict, 'policy_matched');
assert.equal(
  (matchedButUnapproved.body.shipGate as { allowed: boolean }).allowed,
  false,
);
ok('Policy Matched without approvedPolicy:true is not clear to ship');

const clear = await gate({
  network: 'mainnet',
  contractAddress: FIXTURE_CONTRACT,
  policy: { upgradeable: false, owner: FIXTURE_OWNER },
  approvedPolicy: true,
});
assert.equal(clear.body.verdict, 'policy_matched');
assert.equal((clear.body.shipGate as { allowed: boolean }).allowed, true);
ok('allowed=true only for Policy Matched plus explicit approval');

const review = await gate(
  {
    network: 'mainnet',
    contractAddress: FIXTURE_CONTRACT,
    policy: { upgradeable: false, owner: FIXTURE_OWNER },
    approvedPolicy: true,
  },
  makeObservedFacts({
    verification: {
      status: 'unverified',
      evidence: { source: 'fixture verification', block: 12_345 },
    },
  }),
);
assert.equal(review.body.verdict, 'review_required');
assert.equal((review.body.shipGate as { allowed: boolean }).allowed, false);
ok('Review Required is never allowed');

const draftOnly = await gate({
  network: 'mainnet',
  contractAddress: FIXTURE_CONTRACT,
  packId: 'simple_ownable',
  fillFromLive: true,
  approvedPolicy: true,
});
assert.equal(
  (draftOnly.body.shipGate as { allowed: boolean }).allowed,
  false,
);
assert.equal(
  (draftOnly.body.shipGate as { explicitApprovedPolicy: boolean })
    .explicitApprovedPolicy,
  false,
);
ok('live-filled draft alone never clears the ship gate');

const explicitWins = await gate({
  network: 'mainnet',
  contractAddress: FIXTURE_CONTRACT,
  packId: 'simple_ownable',
  fillFromLive: true,
  policy: { owner: WRONG_OWNER, upgradeable: false },
  approvedPolicy: true,
});
assert.equal(explicitWins.body.verdict, 'blocked');
assert.equal(
  (explicitWins.body.draft as { owner: string }).owner.toLowerCase(),
  WRONG_OWNER.toLowerCase(),
);
ok('explicit policy overrides live draft import');

console.log('\nShip-gate deterministic fixtures passed.');
