import type { Address, Hex } from 'viem';

export type NetworkId = 'mainnet' | 'testnet';

export type CheckStatus = 'blocked' | 'review' | 'matched' | 'skipped';
export type Verdict = 'blocked' | 'review_required' | 'policy_matched';

/**
 * Why a check was skipped (only set when status === 'skipped').
 * - out_of_scope: undeclared / optional / not applicable — not a failure
 * - evidence_missing: declared or required, but onchain evidence unreadable — incomplete
 */
export type SkipReason = 'out_of_scope' | 'evidence_missing';

/** How a draft field got its current value. Never auto-approved. */
export type FieldProvenance = 'empty' | 'imported' | 'founder';

export type ManifestFieldKey = keyof ManifestFields;

export interface ManifestFields {
  projectName: string;
  network: NetworkId;
  contractAddress: string;
  expectedDeployer: string;
  owner: string;
  expectedSafe: string;
  minMultisigThreshold: number | null;
  timelockRequired: boolean;
  minTimelockDelaySec: number | null;
  upgradeable: boolean;
  expectedProxyAdminOrUpgradeAuthority: string;
  expectedImplementation: string;
  expectedImplementationCodeHash: string;
  treasury: string;
  feeRecipient: string;
  maxTokenSupply: string;
  /** null = not declared (out of scope). false = minting must not be enabled. */
  mintingAllowedAfterLaunch: boolean | null;
  oracle: string;
  oraclePair: string;
  maxOracleStalenessSec: number | null;
  approvedRouters: string;
  approvedFactories: string;
  approvedPools: string;
  maxFeeBps: number | null;
  maxSlippageBps: number | null;
}

/** Fields that can be filled from live ObservedFacts. */
export const IMPORTABLE_FIELD_KEYS: ManifestFieldKey[] = [
  'expectedDeployer',
  'owner',
  'expectedSafe',
  'minMultisigThreshold',
  'timelockRequired',
  'minTimelockDelaySec',
  'upgradeable',
  'expectedProxyAdminOrUpgradeAuthority',
  'expectedImplementation',
  'expectedImplementationCodeHash',
  'treasury',
  'feeRecipient',
  'maxTokenSupply',
  'oracle',
  'approvedRouters',
];

export type FieldProvenanceMap = Partial<Record<ManifestFieldKey, FieldProvenance>>;

/** Immutable approved snapshot used for re-verify. */
export interface ApprovedManifest {
  version: number;
  fields: ManifestFields;
  approvedAt: string;
  /** Block at which live state was last imported into the draft that became this version (if any). */
  sourceImportBlock: number | null;
}

/**
 * Local policy state for the founder loop.
 * Draft is always editable. Approved is immutable until a new version is approved.
 */
export interface PolicyState {
  draft: ManifestFields;
  provenance: FieldProvenanceMap;
  /** Block number when draft was last filled from live state (null if never imported). */
  lastImportBlock: number | null;
  lastImportAt: string | null;
  approved: ApprovedManifest | null;
}

export interface EvidenceRecord {
  source: string;
  block?: number;
  txHash?: string;
  slot?: string;
  raw?: string;
  note?: string;
}

export interface RoleObservation {
  role: string;
  holders: Address[];
  evidence: EvidenceRecord;
}

export interface VerificationStatus {
  status: 'verified' | 'unverified' | 'unknown';
  source?: string;
  explorerUrl?: string;
  details?: string;
  evidence: EvidenceRecord;
}

export interface ObservedFacts {
  network: NetworkId;
  chainId: number;
  blockNumber: number;
  timestamp: number;
  contractAddress: Address;
  codeHash: Hex | null;
  hasCode: boolean;

  deployer: Address | null;
  deployTxHash: Hex | null;
  deployBlock: number | null;

  owner: Address | null;
  ownerReadMethod: string | null;
  isOwnerContract: boolean | null;
  isSafe: boolean | null;
  safeThreshold: number | null;
  safeOwners: Address[] | null;
  safeEvidence: EvidenceRecord | null;

  isProxy: boolean | null;
  implementation: Address | null;
  implementationCodeHash: Hex | null;
  proxyAdmin: Address | null;
  upgradeAuthority: Address | null;
  upgradeEvidence: EvidenceRecord | null;

  timelockAddress: Address | null;
  timelockMinDelaySec: number | null;
  timelockEvidence: EvidenceRecord | null;

  initializerSealed: boolean | null;
  initializedVersion: number | null;
  initializerEvidence: EvidenceRecord | null;

  totalSupply: string | null;
  /** ERC-20 style name() when readable */
  tokenName: string | null;
  /** ERC-20 style symbol() when readable */
  tokenSymbol: string | null;
  feeRecipient: Address | null;
  treasury: Address | null;
  minterHolders: Address[] | null;
  factory: Address | null;
  pool: Address | null;
  feeBps: number | null;
  slippageBps: number | null;

  oracle: Address | null;
  oracleUpdatedAt: number | null;
  router: Address | null;

  /** Ownable2Step pending owner if exposed. */
  pendingOwner: Address | null;
  /** Best-effort proxy classification. */
  proxyKind: 'transparent' | 'uups' | 'unknown' | null;
  /** True when upgradeAuthority looks like a Safe. */
  upgradeAuthorityIsSafe: boolean | null;
  upgradeAuthoritySafeThreshold: number | null;

  roles: RoleObservation[];
  addressSanityFlags: string[];
  verification: VerificationStatus;
  rawCalls: EvidenceRecord[];
  readErrors: string[];
}

export interface CheckResult {
  id: string;
  checkKey: string;
  status: CheckStatus;
  title: string;
  expected: string;
  actual: string;
  evidence: EvidenceRecord;
  why?: string;
  remediation?: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  /** Present only when status === 'skipped'. */
  skipReason?: SkipReason;
}

export interface Coverage {
  matched: number;
  review: number;
  blocked: number;
  skipped: number;
  /** Undeclared / optional / N/A — subset of skipped. */
  outOfScope: number;
  /** Declared or required but unreadable — subset of skipped. */
  evidenceMissing: number;
  total: number;
}

export interface ScanRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  network: NetworkId;
  contractAddress: Address;
  /** Always the approved immutable snapshot used for this verification. */
  manifest: ManifestFields;
  manifestVersion: number;
  facts: ObservedFacts;
  results: CheckResult[];
  verdict: Verdict;
  coverage: Coverage;
}

export function emptyManifest(partial?: Partial<ManifestFields>): ManifestFields {
  return {
    projectName: '',
    network: 'mainnet',
    contractAddress: '',
    expectedDeployer: '',
    owner: '',
    expectedSafe: '',
    minMultisigThreshold: null,
    timelockRequired: false,
    minTimelockDelaySec: null,
    upgradeable: false,
    expectedProxyAdminOrUpgradeAuthority: '',
    expectedImplementation: '',
    expectedImplementationCodeHash: '',
    treasury: '',
    feeRecipient: '',
    maxTokenSupply: '',
    mintingAllowedAfterLaunch: null,
    oracle: '',
    oraclePair: '',
    maxOracleStalenessSec: null,
    approvedRouters: '',
    approvedFactories: '',
    approvedPools: '',
    maxFeeBps: null,
    maxSlippageBps: null,
    ...partial,
  };
}

export function emptyProvenance(): FieldProvenanceMap {
  return {};
}

export function emptyPolicyState(partial?: Partial<PolicyState>): PolicyState {
  return {
    draft: emptyManifest(),
    provenance: emptyProvenance(),
    lastImportBlock: null,
    lastImportAt: null,
    approved: null,
    ...partial,
  };
}
