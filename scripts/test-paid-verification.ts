import { keccak256, type Address, type Hex } from 'viem';
import {
  buildDeepVerificationBundle,
  buildPrivilegeMap,
  buildReviewedArtifactChecks,
  privilegeProbeAddresses,
  resolveReviewedArtifact,
} from '../server/paidVerification';
import { emptyManifest, type ObservedFacts } from '../src/lib/policy/types';

const ROOT = '0x1111111111111111111111111111111111111111' as Address;
const OWNER = '0x2222222222222222222222222222222222222222' as Address;
const SIGNER = '0x3333333333333333333333333333333333333333' as Address;
const IMPLEMENTATION = '0x4444444444444444444444444444444444444444' as Address;
const ROOT_HASH = (`0x${'aa'.repeat(32)}`) as Hex;
const IMPLEMENTATION_HASH = (`0x${'bb'.repeat(32)}`) as Hex;

function facts(overrides: Partial<ObservedFacts> = {}): ObservedFacts {
  return {
    network: 'mainnet',
    chainId: 196,
    blockNumber: 12345,
    timestamp: 1_700_000_000,
    contractAddress: ROOT,
    codeHash: ROOT_HASH,
    hasCode: true,
    deployer: null,
    deployTxHash: null,
    deployBlock: null,
    owner: OWNER,
    ownerReadMethod: 'owner()',
    isOwnerContract: true,
    isSafe: true,
    safeThreshold: 1,
    safeOwners: [SIGNER],
    safeEvidence: { source: 'Safe getOwners()', block: 12345 },
    isProxy: true,
    implementation: IMPLEMENTATION,
    implementationCodeHash: IMPLEMENTATION_HASH,
    proxyAdmin: OWNER,
    upgradeAuthority: OWNER,
    upgradeEvidence: { source: 'EIP-1967 slots', block: 12345 },
    timelockAddress: null,
    timelockMinDelaySec: null,
    timelockEvidence: null,
    initializerSealed: true,
    initializedVersion: 1,
    initializerEvidence: { source: 'initialized()', block: 12345 },
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
    proxyKind: 'transparent',
    upgradeAuthorityIsSafe: true,
    upgradeAuthoritySafeThreshold: 1,
    roles: [
      {
        role: 'PAUSER_ROLE',
        holders: [OWNER],
        evidence: { source: 'getRoleMember(PAUSER_ROLE)', block: 12345 },
      },
    ],
    addressSanityFlags: [],
    verification: {
      status: 'verified',
      evidence: { source: 'fixture' },
    },
    rawCalls: [],
    readErrors: [],
    ...overrides,
  };
}

let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    console.error(`FAIL: ${message}`);
    failed += 1;
  }
}

{
  const bytecode = '0x6001600055' as Hex;
  const artifact = resolveReviewedArtifact({ deployedBytecode: bytecode });
  assert(artifact.errors.length === 0, 'Foundry-style runtime bytecode accepted');
  assert(
    artifact.expectedRuntimeCodeHash === keccak256(bytecode),
    'runtime bytecode hash computed deterministically',
  );
}

{
  const artifact = resolveReviewedArtifact({
    name: 'Reviewed implementation',
    implementationAddress: IMPLEMENTATION,
    implementationCodeHash: IMPLEMENTATION_HASH,
    reviewedCommit: 'abc123',
  });
  const checks = buildReviewedArtifactChecks(artifact, facts());
  assert(checks.length === 2, 'implementation address and hash checks emitted');
  assert(checks.every((check) => check.status === 'matched'), 'reviewed artifact matches live facts');
}

{
  const currentFacts = facts();
  const probes = privilegeProbeAddresses(currentFacts, []);
  assert(probes.includes(OWNER), 'owner selected for related code probe');
  assert(probes.includes(IMPLEMENTATION), 'implementation selected for related code probe');
  const privilegeMap = buildPrivilegeMap({
    facts: currentFacts,
    inspections: [
      {
        address: OWNER,
        hasCode: true,
        codeHash: (`0x${'cc'.repeat(32)}`) as Hex,
        bytecodeSize: 100,
        evidence: { source: 'fixture' },
      },
      {
        address: IMPLEMENTATION,
        hasCode: true,
        codeHash: IMPLEMENTATION_HASH,
        bytecodeSize: 200,
        evidence: { source: 'fixture' },
      },
    ],
  });
  assert(
    privilegeMap.edges.some((edge) => edge.relationship === 'safe_signer'),
    'Safe signer relationship included',
  );
  assert(
    privilegeMap.edges.some((edge) => edge.relationship === 'access_role:PAUSER_ROLE'),
    'AccessControl relationship included',
  );
}

{
  const currentFacts = facts();
  const artifact = resolveReviewedArtifact({
    implementationAddress: IMPLEMENTATION,
    implementationCodeHash: (`0x${'dd'.repeat(32)}`) as Hex,
  });
  const artifactChecks = buildReviewedArtifactChecks(artifact, currentFacts);
  const privilegeMap = buildPrivilegeMap({
    facts: currentFacts,
    inspections: [],
  });
  const manifest = emptyManifest({
    projectName: 'Paid fixture',
    network: 'mainnet',
    contractAddress: ROOT,
    upgradeable: true,
  });
  const deep = buildDeepVerificationBundle({
    manifest,
    facts: currentFacts,
    coreResults: [],
    artifact,
    artifactChecks,
    privilegeMap,
  });
  assert(deep.verdict === 'blocked', 'artifact hash mismatch blocks paid verdict');
  assert(
    deep.bundle.auditorBrief.markdown.includes('Reviewed artifact'),
    'auditor brief Markdown generated',
  );
  assert(
    deep.bundle.auditorBrief.contentDigest.startsWith('0x'),
    'auditor brief content digest generated',
  );
}

{
  const artifact = resolveReviewedArtifact({ runtimeCodeHash: '0x1234' });
  assert(artifact.errors.length === 1, 'invalid reviewed hash rejected');
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Paid Deep Verification fixtures passed.');
}
