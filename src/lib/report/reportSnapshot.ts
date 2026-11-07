import {
  type Address,
  type Hex,
  keccak256,
  stringToHex,
  getAddress,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import type {
  Coverage,
  ManifestFields,
  ObservedFacts,
  ScanRun,
  Verdict,
} from '../policy/types';
import { policyHash } from '../policy/policyHash';
import { resolveChain } from '../chain/chains';

export interface ReportReceipt {
  recordId: Hex;
  registryAddress: Address;
  publisher: Address;
  transactionHash: Hex;
  publishedAt: number;
}

export interface CompactCheckSummary {
  checkKey: string;
  status: string;
  expected: string;
  actual: string;
  severity: string;
  skipReason?: string;
}

export interface PublicReportFactsSummary {
  hasCode: boolean;
  codeHash: Hex | null;
  owner: Address | null;
  isOwnerContract: boolean | null;
  isSafe: boolean | null;
  isProxy: boolean | null;
  proxyKind: string | null;
  implementation: Address | null;
  upgradeAuthority: Address | null;
  timelockMinDelaySec: number | null;
  verificationStatus: string;
}

export interface ShomerPublicReport {
  format: 'shomer-public-report/v1';
  reportId: string;
  inspectedChain: number;
  chainName: string;
  targetContract: Address;
  inspectedBlock: number;
  inspectedTimestamp: number;
  policyHash: Hex;
  verdict: Verdict;
  coverage: Coverage;
  policy: Partial<ManifestFields>;
  results: CompactCheckSummary[];
  facts: PublicReportFactsSummary;
  disclaimer: string;
  reportHash?: Hex;
  receipt?: ReportReceipt;
}

export interface OnchainVerificationRecord {
  publisher: Address;
  inspectedChain: number;
  targetContract: Address;
  inspectedBlock: number;
  policyHash: Hex;
  reportHash: Hex;
  verdict: number;
  publishedAt: number;
}

export interface ReportIntegrityResult {
  valid: boolean;
  computedReportHash: Hex;
  expectedReportHash: Hex;
  policyHashMatch: boolean;
  chainMatch: boolean;
  targetContractMatch: boolean;
  blockMatch: boolean;
  mismatches: string[];
}

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 * Guarantees stable fingerprints independent of runtime JSON key order.
 */
export function canonicalJson(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean' || typeof val === 'number') return JSON.stringify(val);
  if (typeof val === 'string') return JSON.stringify(val);
  if (typeof val === 'bigint') return JSON.stringify(val.toString());

  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalJson(item)).join(',') + ']';
  }

  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>).sort();
    const parts = keys
      .filter((k) => (val as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((val as Record<string, unknown>)[k])}`);
    return '{' + parts.join(',') + '}';
  }

  return JSON.stringify(val);
}

/**
 * Extracts the canonical payload of a public report for hashing.
 * Excludes mutable/ephemeral receipt and self-referential reportHash.
 */
export function canonicalReportPayload(report: ShomerPublicReport): string {
  const payload = {
    format: report.format,
    inspectedChain: report.inspectedChain,
    targetContract: report.targetContract.toLowerCase(),
    inspectedBlock: report.inspectedBlock,
    inspectedTimestamp: report.inspectedTimestamp,
    policyHash: report.policyHash.toLowerCase(),
    verdict: report.verdict,
    coverage: report.coverage,
    policy: report.policy,
    results: [...report.results].sort((a, b) => a.checkKey.localeCompare(b.checkKey)),
    facts: report.facts,
    disclaimer: report.disclaimer,
  };
  return canonicalJson(payload);
}

/**
 * Computes deterministic keccak256 hash of a public report.
 */
export function computeReportHash(report: ShomerPublicReport): Hex {
  return keccak256(stringToHex(canonicalReportPayload(report)));
}

/**
 * Pure deterministic computation of on-chain record ID matching ShomerVerificationRegistry.
 */
export function computeRecordId(
  publisher: Address,
  inspectedChain: bigint,
  targetContract: Address,
  inspectedBlock: bigint,
  policyHash: Hex,
  reportHash: Hex,
): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, uint256, address, uint256, bytes32, bytes32'),
    [
      getAddress(publisher),
      inspectedChain,
      getAddress(targetContract),
      inspectedBlock,
      policyHash,
      reportHash,
    ],
  );
  return keccak256(encoded);
}

/**
 * Extracts facts summary for public report.
 */
export function extractFactsSummary(facts: ObservedFacts): PublicReportFactsSummary {
  return {
    hasCode: facts.hasCode,
    codeHash: facts.codeHash,
    owner: facts.owner,
    isOwnerContract: facts.isOwnerContract,
    isSafe: facts.isSafe,
    isProxy: facts.isProxy,
    proxyKind: facts.proxyKind,
    implementation: facts.implementation,
    upgradeAuthority: facts.upgradeAuthority,
    timelockMinDelaySec: facts.timelockMinDelaySec,
    verificationStatus: facts.verification?.status ?? 'unknown',
  };
}

/**
 * Builds a versioned, deterministic public report snapshot from a ScanRun.
 */
export function buildPublicReportSnapshot(
  scan: ScanRun,
  receipt?: ReportReceipt,
): ShomerPublicReport {
  const chain = resolveChain(scan.facts.chainId);
  const pHash = policyHash(scan.manifest);
  const targetContract = getAddress(scan.contractAddress);

  const results: CompactCheckSummary[] = scan.results
    .map((r) => ({
      checkKey: r.checkKey,
      status: r.status,
      expected: r.expected,
      actual: r.actual,
      severity: r.severity,
      skipReason: r.skipReason,
    }))
    .sort((a, b) => a.checkKey.localeCompare(b.checkKey));

  const draftPolicy: Partial<ManifestFields> = {};
  for (const [k, v] of Object.entries(scan.manifest)) {
    if (v !== '' && v !== null && v !== undefined && k !== 'projectName' && k !== 'network') {
      (draftPolicy as Record<string, unknown>)[k] = v;
    }
  }

  const baseReport: Omit<ShomerPublicReport, 'reportId' | 'reportHash'> = {
    format: 'shomer-public-report/v1',
    inspectedChain: chain.id,
    chainName: chain.name,
    targetContract,
    inspectedBlock: scan.facts.blockNumber,
    inspectedTimestamp: scan.facts.timestamp,
    policyHash: pHash,
    verdict: scan.verdict,
    coverage: scan.coverage,
    policy: draftPolicy,
    results,
    facts: extractFactsSummary(scan.facts),
    disclaimer:
      'A verification receipt establishes publication and integrity only; it does not claim safety, security, or an audit.',
  };

  const hash = keccak256(stringToHex(canonicalReportPayload(baseReport as ShomerPublicReport)));
  const reportId = `shomer-${chain.id}-${scan.facts.blockNumber}-${hash.slice(2, 14)}`;

  const finalReport: ShomerPublicReport = {
    ...baseReport,
    reportId,
    reportHash: hash,
    receipt,
  };

  return finalReport;
}

/**
 * Compares an exported public report against an on-chain verification record.
 * Any alteration to report contents, block, chain, policy, or target contract
 * invalidates the comparison.
 */
export function verifyReportIntegrity(
  report: ShomerPublicReport,
  onchainRecord: OnchainVerificationRecord,
): ReportIntegrityResult {
  const computedHash = computeReportHash(report);
  const mismatches: string[] = [];

  const expectedHash = onchainRecord.reportHash.toLowerCase() as Hex;
  const computedHashLower = computedHash.toLowerCase() as Hex;

  if (computedHashLower !== expectedHash) {
    mismatches.push(
      `Report hash mismatch: computed ${computedHashLower} vs onchain ${expectedHash}. Report content has been modified or corrupted.`,
    );
  }

  const policyMatch =
    report.policyHash.toLowerCase() === onchainRecord.policyHash.toLowerCase();
  if (!policyMatch) {
    mismatches.push(
      `Policy hash mismatch: report ${report.policyHash} vs onchain ${onchainRecord.policyHash}.`,
    );
  }

  const chainMatch = report.inspectedChain === onchainRecord.inspectedChain;
  if (!chainMatch) {
    mismatches.push(
      `Chain mismatch: report inspected chain ${report.inspectedChain} vs onchain record ${onchainRecord.inspectedChain}.`,
    );
  }

  const targetContractMatch =
    report.targetContract.toLowerCase() === onchainRecord.targetContract.toLowerCase();
  if (!targetContractMatch) {
    mismatches.push(
      `Target contract mismatch: report target ${report.targetContract} vs onchain record ${onchainRecord.targetContract}.`,
    );
  }

  const blockMatch = report.inspectedBlock === onchainRecord.inspectedBlock;
  if (!blockMatch) {
    mismatches.push(
      `Inspected block mismatch: report block ${report.inspectedBlock} vs onchain record ${onchainRecord.inspectedBlock}.`,
    );
  }

  return {
    valid: mismatches.length === 0,
    computedReportHash: computedHash,
    expectedReportHash: onchainRecord.reportHash,
    policyHashMatch: policyMatch,
    chainMatch,
    targetContractMatch,
    blockMatch,
    mismatches,
  };
}
