/**
 * Pure policy-engine fixtures (no RPC). Run: npm run test:engine
 */
import { runPolicyChecks, verdictOf } from '../src/lib/policy/engine';
import { emptyManifest, type ObservedFacts } from '../src/lib/policy/types';
import { resolvePolicyPreset } from '../src/lib/policy/presets';
import { seedDraftFromPack, listPolicyPacks } from '../src/lib/policy/packs';
import { diffManifestFields } from '../src/lib/policy/diff';
import { getAddress, type Hex } from 'viem';

const OWNER = getAddress('0xc5a76EC865cF7540F51547461Db3C25254CE42F3');
const WRONG = getAddress('0x5aFe00000000000000000000000000000000d021');
const CONTRACT = getAddress('0xbff976f8874814e6f2ee98d559826812ff26597f');
const MINTER = getAddress('0x1111111111111111111111111111111111111111');

function baseFacts(over: Partial<ObservedFacts> = {}): ObservedFacts {
  return {
    network: 'mainnet',
    chainId: 196,
    blockNumber: 65000000,
    timestamp: 1_700_000_000,
    contractAddress: CONTRACT,
    codeHash: ('0x' + 'ab'.repeat(32)) as Hex,
    hasCode: true,
    deployer: null,
    deployTxHash: null,
    deployBlock: null,
    owner: OWNER,
    ownerReadMethod: 'owner()',
    isOwnerContract: false,
    isSafe: false,
    safeThreshold: null,
    safeOwners: null,
    safeEvidence: null,
    isProxy: false,
    implementation: null,
    implementationCodeHash: null,
    proxyAdmin: null,
    upgradeAuthority: null,
    upgradeEvidence: null,
    timelockAddress: null,
    timelockMinDelaySec: null,
    timelockEvidence: null,
    initializerSealed: null,
    initializedVersion: null,
    initializerEvidence: null,
    totalSupply: null,
    tokenName: null,
    tokenSymbol: null,
    feeRecipient: null,
    treasury: null,
    minterHolders: null,
    factory: null,
    pool: null,
    feeBps: null,
    slippageBps: null,
    oracle: null,
    oracleUpdatedAt: null,
    router: null,
    pendingOwner: null,
    proxyKind: null,
    upgradeAuthorityIsSafe: null,
    upgradeAuthoritySafeThreshold: null,
    roles: [],
    addressSanityFlags: [],
    verification: { status: 'unknown', evidence: { source: 'test' } },
    rawCalls: [],
    readErrors: [],
    ...over,
  };
}

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('ok:', msg);
  }
}

// 1) matched owner
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
  });
  const { results, verdict } = runPolicyChecks(m, baseFacts());
  assert(results.find((r) => r.checkKey === 'owner_matches')?.status === 'matched', 'owner matched');
  assert(verdict === 'policy_matched' || verdict === 'review_required', `verdict ${verdict}`);
}

// 2) blocked wrong owner
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: WRONG,
    upgradeable: false,
  });
  const { verdict } = runPolicyChecks(m, baseFacts());
  assert(verdict === 'blocked', 'wrong owner blocked');
}

// 3) evidence_missing blocks matched
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    expectedDeployer: OWNER,
    upgradeable: false,
  });
  const { results, verdict } = runPolicyChecks(m, baseFacts({ deployer: null }));
  const dep = results.find((r) => r.checkKey === 'chain_and_deployer');
  assert(dep?.skipReason === 'evidence_missing', 'deployer evidence_missing');
  assert(verdict === 'review_required', 'evidence_missing => review');
  assert(verdictOf(results) === 'review_required', 'verdictOf');
}

// 4) undeclared review / out_of_scope
{
  const m = emptyManifest({ network: 'mainnet', contractAddress: CONTRACT, upgradeable: false });
  assert(
    runPolicyChecks(m, baseFacts()).results.find((r) => r.checkKey === 'owner_matches')?.status ===
      'review',
    'undeclared owner review',
  );
  assert(
    runPolicyChecks(m, baseFacts(), { undeclaredObserved: 'out_of_scope' }).results.find(
      (r) => r.checkKey === 'owner_matches',
    )?.skipReason === 'out_of_scope',
    'undeclared out_of_scope',
  );
}

// 5) option never hides mismatch
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: WRONG,
    upgradeable: false,
  });
  assert(
    runPolicyChecks(m, baseFacts(), { undeclaredObserved: 'out_of_scope' }).verdict === 'blocked',
    'mismatch still blocked',
  );
}

// 6) max supply
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
    maxTokenSupply: '1000',
  });
  assert(
    runPolicyChecks(m, baseFacts({ totalSupply: '500' })).results.find(
      (r) => r.checkKey === 'max_token_supply',
    )?.status === 'matched',
    'supply under max',
  );
  assert(
    runPolicyChecks(m, baseFacts({ totalSupply: '2000' })).results.find(
      (r) => r.checkKey === 'max_token_supply',
    )?.status === 'blocked',
    'supply over max',
  );
}

// 7) minting forbidden
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
    mintingAllowedAfterLaunch: false,
  });
  assert(
    runPolicyChecks(m, baseFacts({ minterHolders: [MINTER] })).results.find(
      (r) => r.checkKey === 'minting_policy',
    )?.status === 'blocked',
    'mint blocked when forbidden',
  );
  assert(
    runPolicyChecks(m, baseFacts({ minterHolders: [] })).results.find(
      (r) => r.checkKey === 'minting_policy',
    )?.status === 'matched',
    'mint matched when no minters',
  );
}

// 8) mint null = out of scope
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
    mintingAllowedAfterLaunch: null,
  });
  assert(
    runPolicyChecks(m, baseFacts({ minterHolders: [MINTER] })).results.find(
      (r) => r.checkKey === 'minting_policy',
    )?.skipReason === 'out_of_scope',
    'mint null out of scope',
  );
}

// 9) oracle staleness
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
    maxOracleStalenessSec: 3600,
  });
  const fresh = baseFacts({
    oracle: OWNER,
    oracleUpdatedAt: 1_700_000_000 - 60,
    timestamp: 1_700_000_000,
  });
  assert(
    runPolicyChecks(m, fresh).results.find((r) => r.checkKey === 'oracle_staleness')?.status ===
      'matched',
    'oracle fresh',
  );
  const stale = baseFacts({
    oracle: OWNER,
    oracleUpdatedAt: 1_700_000_000 - 10_000,
    timestamp: 1_700_000_000,
  });
  assert(
    runPolicyChecks(m, stale).results.find((r) => r.checkKey === 'oracle_staleness')?.status ===
      'blocked',
    'oracle stale',
  );
}

// 10) pending owner => review
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
  });
  assert(
    runPolicyChecks(m, baseFacts({ pendingOwner: WRONG })).results.find(
      (r) => r.checkKey === 'pending_owner',
    )?.status === 'review',
    'pending owner review',
  );
}

// 11) presets
{
  const p = resolvePolicyPreset('non_upgradeable');
  assert(p?.upgradeable === false, 'preset non_upgradeable');
  const m = emptyManifest({
    ...resolvePolicyPreset('immutable_token'),
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
  });
  assert(m.mintingAllowedAfterLaunch === false, 'immutable_token mint false');
  assert(m.upgradeable === false, 'immutable_token not upgradeable');
}

// 12) fee bps
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
    maxFeeBps: 30,
  });
  assert(
    runPolicyChecks(m, baseFacts({ feeBps: 25 })).results.find((r) => r.checkKey === 'max_fee_bps')
      ?.status === 'matched',
    'fee ok',
  );
  assert(
    runPolicyChecks(m, baseFacts({ feeBps: 100 })).results.find((r) => r.checkKey === 'max_fee_bps')
      ?.status === 'blocked',
    'fee high blocked',
  );
}

// 13) packs seed draft only
{
  assert(listPolicyPacks().length >= 5, 'five packs');
  const s = seedDraftFromPack({
    packId: 'simple_ownable',
    network: 'mainnet',
    contractAddress: CONTRACT,
  });
  assert(s.ok === true && s.status === 'draft_only', 'pack draft_only');
  if (s.ok) {
    assert(s.draft.upgradeable === false, 'ownable not upgradeable');
    assert(s.draft.owner === '', 'pack does not invent owner');
  }
  const bad = seedDraftFromPack({ packId: 'nope' });
  assert(bad.ok === false, 'unknown pack fails');
}

// 14) policy diff
{
  const a = emptyManifest({ owner: OWNER, upgradeable: false, network: 'mainnet', contractAddress: CONTRACT });
  const b = emptyManifest({ owner: WRONG, upgradeable: true, network: 'mainnet', contractAddress: CONTRACT });
  const d = diffManifestFields(a, b);
  assert(d.some((x) => x.key === 'owner' && x.kind === 'changed'), 'diff owner');
  assert(d.some((x) => x.key === 'upgradeable'), 'diff upgradeable');
}

// 15) an approved owner does not implicitly approve separate AccessControl roles
{
  const m = emptyManifest({
    network: 'mainnet',
    contractAddress: CONTRACT,
    owner: OWNER,
    upgradeable: false,
  });
  const roleEvidence = { source: 'getRoleMember(PAUSER_ROLE)', block: 65_000_000 };
  const { results, verdict } = runPolicyChecks(
    m,
    baseFacts({
      roles: [{ role: 'PAUSER_ROLE', holders: [OWNER], evidence: roleEvidence }],
    }),
  );
  assert(
    results.find((r) => r.checkKey === 'role_pauser_role')?.status === 'review',
    'owner-held undeclared pauser role requires review',
  );
  assert(verdict === 'review_required', 'undeclared pauser role => review required');
}

if (failed) {
  console.error(`\n${failed} fixture(s) failed`);
  process.exit(1);
}
console.log('\nAll engine fixtures passed');
