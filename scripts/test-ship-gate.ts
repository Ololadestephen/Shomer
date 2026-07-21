/**
 * Ship-gate integrity fixtures (no double-read / no live-as-policy / allowed rules).
 * Run: npx vite-node scripts/test-ship-gate.ts
 */
import { hasExplicitApprovedPolicy } from '../server/agentShipGate';
import { emptyManifest } from '../src/lib/policy/types';

let failed = 0;
function assert(c: boolean, msg: string) {
  if (c) console.log('ok:', msg);
  else {
    console.error('FAIL:', msg);
    failed++;
  }
}

// explicit policy detection
assert(
  hasExplicitApprovedPolicy({ owner: '0x1111111111111111111111111111111111111111' }) === true,
  'owner field counts as explicit',
);
assert(
  hasExplicitApprovedPolicy({ upgradeable: false }) === false,
  'upgradeable alone is not enough',
);
assert(
  hasExplicitApprovedPolicy(undefined) === false,
  'empty policy not explicit',
);
assert(
  hasExplicitApprovedPolicy(
    { owner: '0x1111111111111111111111111111111111111111' },
    false,
  ) === false,
  'approvedPolicy:false blocks explicit',
);
assert(
  hasExplicitApprovedPolicy(
    emptyManifest({
      owner: '0x1111111111111111111111111111111111111111',
      upgradeable: false,
    }),
    true,
  ) === true,
  'approvedPolicy:true with owner is explicit',
);

// Live integration: wrong owner with approvedPolicy must not allow
import { runAgentShipGate } from '../server/agentShipGate';

const CONTRACT = '0xbff976f8874814e6f2ee98d559826812ff26597f';
const WRONG = '0x5aFe00000000000000000000000000000000d021';

const blocked = await runAgentShipGate({
  network: 'mainnet',
  contractAddress: CONTRACT,
  policy: { upgradeable: false, owner: WRONG },
  approvedPolicy: true,
  fillFromLive: false,
});
assert(blocked.body.ok === true, 'blocked request ok');
assert(blocked.body.verdict === 'blocked', 'wrong owner blocked');
assert(
  (blocked.body.shipGate as { allowed?: boolean })?.allowed === false,
  'allowed false when blocked',
);
assert(
  (blocked.body as { chainReads?: number }).chainReads === 1,
  'single chain read on ship-gate',
);

// fillFromLive + pack must NOT auto-clear without explicit policy
const tautology = await runAgentShipGate({
  network: 'mainnet',
  contractAddress: CONTRACT,
  packId: 'simple_ownable',
  fillFromLive: true,
  // no explicit owner in policy
  approvedPolicy: true,
});
const sg = tautology.body.shipGate as {
  allowed?: boolean;
  explicitApprovedPolicy?: boolean;
  recommendation?: string;
};
assert(
  sg?.allowed !== true,
  'fillFromLive pack alone never yields allowed=true',
);
assert(
  sg?.explicitApprovedPolicy === false || tautology.body.verdict !== 'policy_matched' || sg?.allowed === false,
  'no ship clear without substantive explicit policy',
);

// matched path with real owner
const liveOwner = (blocked.body.facts as { owner?: string } | undefined)?.owner;
if (liveOwner) {
  const clear = await runAgentShipGate({
    network: 'mainnet',
    contractAddress: CONTRACT,
    policy: { upgradeable: false, owner: liveOwner },
    approvedPolicy: true,
    fillFromLive: false,
  });
  const csg = clear.body.shipGate as { allowed?: boolean };
  // owner match may still be review_required due to verification etc.
  if (clear.body.verdict === 'policy_matched') {
    assert(csg?.allowed === true, 'allowed true only on policy_matched + explicit');
  } else {
    assert(csg?.allowed === false, 'review_required => allowed false');
  }
  assert(
    (clear.body as { chainReads?: number }).chainReads === 1,
    'single chain read on second call',
  );
}

if (failed) {
  console.error(`\n${failed} ship-gate fixture(s) failed`);
  process.exit(1);
}
console.log('\nShip-gate integrity fixtures passed');
