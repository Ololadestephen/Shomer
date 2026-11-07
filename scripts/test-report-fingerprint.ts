import {
  buildPublicReportSnapshot,
  computeReportHash,
  verifyReportIntegrity,
  type ShomerPublicReport,
  type OnchainVerificationRecord,
} from '../src/lib/report/reportSnapshot';
import { runPolicyChecks } from '../src/lib/policy/engine';
import { emptyManifest, type ScanRun } from '../src/lib/policy/types';
import { loadLastFacts, loadLastScan, saveLastFacts, saveLastScan } from '../src/lib/storage';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function runReportTests(): Promise<void> {
  console.log('Testing public report snapshot, deterministic fingerprints, and tampering checks...');

  // Setup a realistic BOT Chain scan run
  const botChainId = 677;
  const inspectedBlock = 19263053;
  const contractAddress = '0x1559C3a6B02E331307438D7839016EA5A827F467' as const;
  const ownerAddress = '0x466e3B26b771e89F4B3CDE91567117Fe68F25693' as const;

  const manifest = emptyManifest({
    projectName: 'BOT Chain Governance',
    network: 'botchain-mainnet',
    contractAddress,
    owner: ownerAddress,
    upgradeable: false,
  });

  const facts = {
    network: 'botchain-mainnet' as const,
    chainId: botChainId,
    blockNumber: inspectedBlock,
    timestamp: 1730818800,
    contractAddress,
    codeHash: '0xdd02e913a2113e1f1ebe3fc360452b6947daac85d0f0543ad881a5bd7e55afab' as const,
    hasCode: true,
    deployer: null, // Explorer data missing on BOT Chain
    deployTxHash: null,
    deployBlock: null,
    owner: ownerAddress,
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
    verification: {
      status: 'unknown' as const,
      evidence: { source: 'Sourcify', note: 'Not found on Sourcify for chain 677' },
    },
    rawCalls: [],
    readErrors: [],
  };

  const { results, verdict, coverage } = runPolicyChecks(
    manifest,
    facts,
    { undeclaredObserved: 'out_of_scope' },
  );

  const scan: ScanRun = {
    id: `scan-${botChainId}-${inspectedBlock}`,
    startedAt: new Date(1730818800000).toISOString(),
    finishedAt: new Date(1730818801000).toISOString(),
    network: 'botchain-mainnet',
    contractAddress,
    manifest,
    manifestVersion: 1,
    facts,
    results,
    verdict,
    coverage,
  };

  // 1. Report Snapshot & Fingerprint Stability
  const report1 = buildPublicReportSnapshot(scan);
  const hash1 = computeReportHash(report1);

  // Generate a second time — must produce identical hash
  const report2 = buildPublicReportSnapshot(scan);
  const hash2 = computeReportHash(report2);

  assert(hash1 === hash2, `Report hash must be deterministic: ${hash1} !== ${hash2}`);
  assert(hash1 === report1.reportHash, 'Report hash field must match computeReportHash()');
  console.log('ok: report serialization produces stable fingerprints');

  // 2. Simulated Onchain Record Comparison
  const onchainRecord: OnchainVerificationRecord = {
    publisher: '0x1111111111111111111111111111111111111111',
    inspectedChain: botChainId,
    targetContract: contractAddress,
    inspectedBlock,
    policyHash: report1.policyHash,
    reportHash: hash1,
    verdict: verdict === 'policy_matched' ? 2 : verdict === 'review_required' ? 1 : 0,
    publishedAt: 1730818810,
  };

  const cleanCheck = verifyReportIntegrity(report1, onchainRecord);
  assert(cleanCheck.valid, `Intact report should pass verification: ${cleanCheck.mismatches.join(', ')}`);
  console.log('ok: authentic report matches onchain verification record');

  // 3. Tampering: Altered Verdict
  const tamperedVerdictReport: ShomerPublicReport = JSON.parse(JSON.stringify(report1));
  tamperedVerdictReport.verdict = 'policy_matched'; // Maliciously flipped verdict
  const tamperedVerdictCheck = verifyReportIntegrity(tamperedVerdictReport, onchainRecord);
  assert(!tamperedVerdictCheck.valid, 'Tampered verdict must fail integrity check');
  assert(
    tamperedVerdictCheck.mismatches.some((m) => m.includes('Report hash mismatch')),
    'Must report hash mismatch when verdict is altered',
  );
  console.log('ok: editing exported verdict causes receipt comparison to fail');

  // 4. Tampering: Altered Block Number
  const tamperedBlockReport: ShomerPublicReport = JSON.parse(JSON.stringify(report1));
  tamperedBlockReport.inspectedBlock = 99999999;
  const tamperedBlockCheck = verifyReportIntegrity(tamperedBlockReport, onchainRecord);
  assert(!tamperedBlockCheck.valid, 'Tampered block number must fail integrity check');
  console.log('ok: editing inspected block causes receipt comparison to fail');

  // 5. Tampering: Altered Target Contract
  const tamperedTargetReport: ShomerPublicReport = JSON.parse(JSON.stringify(report1));
  tamperedTargetReport.targetContract = '0x000000000000000000000000000000000000dEaD';
  const tamperedTargetCheck = verifyReportIntegrity(tamperedTargetReport, onchainRecord);
  assert(!tamperedTargetCheck.valid, 'Tampered target address must fail integrity check');
  console.log('ok: editing target contract address causes receipt comparison to fail');

  // 6. Cross-Chain Cache Isolation in Storage
  // Save an X Layer fact in storage
  const mockStorage = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => mockStorage.get(k) || null,
    setItem: (k: string, v: string) => {
      mockStorage.set(k, v);
    },
    removeItem: (k: string) => {
      mockStorage.delete(k);
    },
    clear: () => mockStorage.clear(),
    length: 0,
    key: () => null,
  };

  const xLayerFacts = {
    ...facts,
    network: 'mainnet' as const,
    chainId: 196,
    contractAddress: '0x5839244eab49314bccc0fa76e3a081cb1a461111' as const,
  };
  saveLastFacts(xLayerFacts);

  // When asking for BOT Chain facts, X Layer cache MUST NOT be returned!
  const loadedFactsForBotChain = loadLastFacts({ chainId: 677 });
  assert(
    loadedFactsForBotChain === null,
    'BOT Chain query must NEVER return cached facts from X Layer',
  );

  // When asking for X Layer facts, X Layer cache is returned
  const loadedFactsForXLayer = loadLastFacts({ chainId: 196 });
  assert(
    loadedFactsForXLayer !== null && loadedFactsForXLayer.chainId === 196,
    'X Layer query returns X Layer facts',
  );

  // Save BOT Chain scan
  saveLastScan(scan);
  const loadedScanForXLayer = loadLastScan({ chainId: 196 });
  assert(
    loadedScanForXLayer === null,
    'X Layer query must NEVER return scan from BOT Chain',
  );

  const loadedScanForBotChain = loadLastScan({ chainId: 677 });
  assert(
    loadedScanForBotChain !== null && loadedScanForBotChain.facts.chainId === 677,
    'BOT Chain scan loaded cleanly for BOT Chain query',
  );
  console.log('ok: cross-chain storage cache isolation verified');

  // 7. Missing Explorer Data Cannot Silently Produce Policy Matched
  const manifestRequiringDeployer = emptyManifest({
    projectName: 'BOT Chain Strict',
    network: 'botchain-mainnet',
    contractAddress,
    owner: ownerAddress,
    expectedDeployer: '0x1111111111111111111111111111111111111111',
    upgradeable: false,
  });

  const strictCheck = runPolicyChecks(
    manifestRequiringDeployer,
    facts, // deployer is null because BOT Chain has no OKLink
  );

  assert(
    strictCheck.verdict === 'review_required',
    `Missing deployer evidence must yield review_required, got ${strictCheck.verdict}`,
  );
  const deployerCheck = strictCheck.results.find((r) => r.checkKey === 'chain_and_deployer');
  assert(
    deployerCheck?.status === 'skipped' && deployerCheck.skipReason === 'evidence_missing',
    'Deployer check must be marked skipped with evidence_missing',
  );
  console.log('ok: missing explorer data cannot silently produce a passing verdict');

  console.log('All report fingerprint and integrity tests passed.');
}

runReportTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
