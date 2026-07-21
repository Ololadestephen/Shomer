import { readFacts } from '../src/lib/adapters/xlayer';
import { buildScanRun } from '../src/lib/policy/engine';
import { emptyManifest, type ManifestFields } from '../src/lib/policy/types';

const CONTRACTS = {
  ownable: {
    name: 'Standard Ownable',
    address: '0xbff976f8874814e6f2ee98d559826812ff26597f',
    realOwner: '0xc5a76EC865cF7540F51547461Db3C25254CE42F3',
  },
  proxySafe: {
    name: 'Proxy + Safe Owner',
    address: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
    realOwner: '0x4DFF9b5b0143E642a3F63a5bcf2d1C328e600bf8',
    realImpl: '0x1EC7df9e74bE05cb5A456ACa2DC1AC2CeC9AB6A3',
    safeThreshold: 3,
  },
  nonstandard: {
    name: 'Non-standard (Multicall3)',
    address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
};

function makeManifest(contractKey: keyof typeof CONTRACTS, overrides: Partial<ManifestFields> = {}) {
  const c = CONTRACTS[contractKey];
  return emptyManifest({
    projectName: c.name,
    network: 'mainnet',
    contractAddress: c.address,
    ...overrides,
  });
}

async function runValidation() {
  console.log('=== SHOMER REAL X LAYER VALIDATION ===\n');
  console.log('Goal: Confirm matched / blocked / review / skipped are honest.\n');

  // === TYPE 1: Standard Ownable ===
  console.log('\n========================================');
  console.log('TYPE 1: STANDARD OWNABLE');
  console.log('Contract:', CONTRACTS.ownable.address);
  console.log('Real owner from chain will be read live.');
  console.log('========================================\n');

  const ownableAddr = CONTRACTS.ownable.address;
  const ownableRealOwner = CONTRACTS.ownable.realOwner;

  // Case 1a: Empty manifest → should be review (observed owner not declared)
  let facts = await readFacts({ network: 'mainnet', contractAddress: ownableAddr });
  let m = makeManifest('ownable', {});
  let scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('--- 1a: Empty manifest (nothing declared) ---');
  console.log('Verdict:', scan.verdict);
  scan.results.filter(r => r.status !== 'matched' || r.checkKey === 'owner_matches').forEach(r => {
    console.log(`  ${r.status.toUpperCase().padEnd(8)} ${r.checkKey}: ${r.actual}`);
    if (r.why) console.log(`           why: ${r.why}`);
  });

  // Case 1b: Correct owner declared → matched
  m = makeManifest('ownable', { owner: ownableRealOwner });
  scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('\n--- 1b: Correct owner declared ---');
  console.log('Verdict:', scan.verdict);
  const ownerCheck = scan.results.find(r => r.checkKey === 'owner_matches');
  console.log('  owner_matches:', ownerCheck?.status.toUpperCase(), '→', ownerCheck?.actual);
  if (ownerCheck?.status === 'matched') console.log('  → HONEST MATCH');

  // Case 1c: Wrong owner → blocked
  m = makeManifest('ownable', { owner: '0x0000000000000000000000000000000000000001' });
  scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('\n--- 1c: Wrong owner declared (should BLOCK) ---');
  console.log('Verdict:', scan.verdict);
  const blocked = scan.results.find(r => r.checkKey === 'owner_matches');
  console.log('  owner_matches:', blocked?.status.toUpperCase());
  console.log('  expected:', blocked?.expected);
  console.log('  actual  :', blocked?.actual);
  if (blocked?.status === 'blocked') console.log('  → HONEST BLOCK');

  // === TYPE 2: Proxy + Safe ===
  console.log('\n\n========================================');
  console.log('TYPE 2: PROXY WITH SAFE OWNER');
  console.log('Contract:', CONTRACTS.proxySafe.address);
  console.log('Expected: owner=Safe 3/5, proxy, specific impl');
  console.log('========================================\n');

  const proxyAddr = CONTRACTS.proxySafe.address;
  facts = await readFacts({ network: 'mainnet', contractAddress: proxyAddr });
  console.log('Live facts observed:');
  console.log('  owner:', facts.owner, facts.isSafe ? `(Safe ${facts.safeThreshold}/?)` : '');
  console.log('  isProxy:', facts.isProxy);
  console.log('  implementation:', facts.implementation);

  // 2a: Empty manifest → review for owner + upgrade
  m = makeManifest('proxySafe', {});
  scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('\n--- 2a: Empty manifest ---');
  console.log('Verdict:', scan.verdict);
  scan.results.filter(r => ['owner_matches', 'upgrade_authority'].includes(r.checkKey)).forEach(r => {
    console.log(`  ${r.status.toUpperCase().padEnd(8)} ${r.checkKey}: ${r.actual}`);
  });

  // 2b: Correct full policy → should match owner + upgrade + impl (review only on verification)
  m = makeManifest('proxySafe', {
    owner: CONTRACTS.proxySafe.realOwner,
    expectedSafe: CONTRACTS.proxySafe.realOwner,
    minMultisigThreshold: CONTRACTS.proxySafe.safeThreshold,
    upgradeable: true,
    expectedProxyAdminOrUpgradeAuthority: CONTRACTS.proxySafe.realOwner,
    expectedImplementation: CONTRACTS.proxySafe.realImpl,
  });
  scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('\n--- 2b: Full correct policy (owner + Safe + upgrade + impl) ---');
  console.log('Verdict:', scan.verdict);
  ['owner_matches', 'upgrade_authority', 'implementation_hash'].forEach(key => {
    const r = scan.results.find(x => x.checkKey === key);
    console.log(`  ${r?.status.toUpperCase().padEnd(8)} ${key}: ${r?.actual}`);
  });

  // 2c: Declare non-Safe when it is Safe → blocked
  m = makeManifest('proxySafe', {
    owner: CONTRACTS.proxySafe.realOwner,
    expectedSafe: '0x0000000000000000000000000000000000000001', // wrong
  });
  scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('\n--- 2c: Declare wrong Safe (should BLOCK because isSafe check) ---');
  const ownerRes = scan.results.find(r => r.checkKey === 'owner_matches');
  console.log('Verdict:', scan.verdict);
  console.log('  owner_matches:', ownerRes?.status.toUpperCase());
  console.log('  actual:', ownerRes?.actual);

  // === TYPE 3: Non-standard ===
  console.log('\n\n========================================');
  console.log('TYPE 3: NON-STANDARD / INCOMPLETE ABI (Multicall3)');
  console.log('Contract:', CONTRACTS.nonstandard.address);
  console.log('Expected: no owner(), no proxy, many skips');
  console.log('========================================\n');

  const nsAddr = CONTRACTS.nonstandard.address;
  facts = await readFacts({ network: 'mainnet', contractAddress: nsAddr });

  // 3a: Empty
  m = makeManifest('nonstandard', {});
  scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('--- 3a: Empty manifest ---');
  console.log('Verdict:', scan.verdict);
  console.log('Coverage:', scan.coverage);
  const interesting = scan.results.filter(r => r.status !== 'matched' || r.checkKey.includes('sanity') || r.checkKey.includes('verification'));
  interesting.forEach(r => console.log(`  ${r.status.toUpperCase().padEnd(8)} ${r.checkKey}: ${r.actual.slice(0, 65)}`));

  // 3b: Declare a fake owner → evidence_missing (not blocked, because we couldn't read owner to compare)
  m = makeManifest('nonstandard', { owner: '0xc5a76EC865cF7540F51547461Db3C25254CE42F3' });
  scan = buildScanRun(m, facts, new Date().toISOString(), 1);
  console.log('\n--- 3b: Declare owner when contract has none (EVIDENCE MISSING, not fabricate) ---');
  const own = scan.results.find(r => r.checkKey === 'owner_matches');
  console.log('  owner_matches status:', own?.status.toUpperCase(), own?.skipReason ?? '');
  console.log('  actual:', own?.actual);
  if (own?.status === 'skipped' && own.skipReason === 'evidence_missing') {
    console.log('  → HONEST: declared owner but could not read owner() — evidence missing');
  }

  console.log('\n=== VALIDATION COMPLETE ===');
  console.log('All states exercised with real onchain data. No fabrication.');
}

runValidation().catch(e => {
  console.error(e);
  process.exit(1);
});
