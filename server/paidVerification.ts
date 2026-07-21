import {
  isHex,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';
import type { RelatedAddressInspection } from '../src/lib/adapters/xlayer';
import { verdictOf } from '../src/lib/policy/engine';
import type {
  CheckResult,
  Coverage,
  EvidenceRecord,
  ManifestFields,
  ObservedFacts,
  Verdict,
} from '../src/lib/policy/types';
import { addressesEqual, normalizeAddress } from '../src/lib/utils/address';

export const PAID_BUNDLE_VERSION = 'shomer-deep-verification/v1';
export const MAX_RELATED_CODE_PROBES = 8;

export type RelatedContractInput =
  | string
  | {
      address: string;
      label?: string;
    };

export interface ReviewedArtifactInput {
  /** Human-readable artifact/contract label. */
  name?: string;
  /** Optional reviewed Git commit or release identifier. */
  reviewedCommit?: string;
  /** Expected root runtime hash for a non-proxy deployment. */
  runtimeCodeHash?: string;
  /** Expected implementation address for a proxy. */
  implementationAddress?: string;
  /** Expected implementation runtime hash for a proxy. */
  implementationCodeHash?: string;
  /** Foundry-compatible deployed runtime bytecode or { object: "0x..." }. */
  deployedBytecode?: string | { object?: string };
}

export interface ResolvedReviewedArtifact {
  provided: boolean;
  name: string | null;
  reviewedCommit: string | null;
  expectedRuntimeCodeHash: Hex | null;
  expectedImplementationAddress: Address | null;
  expectedImplementationCodeHash: Hex | null;
  bytecodeHashComputed: Hex | null;
  errors: string[];
}

export interface PrivilegeMapNode {
  address: Address;
  kind: 'contract' | 'eoa' | 'unknown';
  labels: string[];
  roles: string[];
  codeHash: Hex | null;
  bytecodeSize: number | null;
}

export interface PrivilegeMapEdge {
  from: Address;
  to: Address;
  relationship: string;
  evidence: EvidenceRecord;
}

export interface PrivilegeMap {
  rootAddress: Address;
  blockNumber: number;
  nodes: PrivilegeMapNode[];
  edges: PrivilegeMapEdge[];
  discoveredAddressCount: number;
  codeProbedAddressCount: number;
  limitations: string[];
}

export interface ArtifactComparison {
  status: 'matched' | 'blocked' | 'review_required' | 'not_provided';
  artifactName: string | null;
  reviewedCommit: string | null;
  expected: {
    runtimeCodeHash: Hex | null;
    implementationAddress: Address | null;
    implementationCodeHash: Hex | null;
  };
  actual: {
    runtimeCodeHash: Hex | null;
    implementationAddress: Address | null;
    implementationCodeHash: Hex | null;
  };
  checks: string[];
}

export interface AuditorBriefFinding {
  checkKey: string;
  status: string;
  severity: string;
  title: string;
  expected: string;
  actual: string;
  why?: string;
  remediation?: string;
  evidence?: EvidenceRecord;
}

export interface AuditorBrief {
  format: 'shomer-auditor-brief/v1';
  reportId: string;
  contentDigest: Hex;
  generatedAt: string;
  observedAt: string;
  projectName: string;
  scope: {
    network: string;
    chainId: number;
    blockNumber: number;
    contractAddress: Address;
  };
  verdict: Verdict;
  coverage: Coverage;
  findings: AuditorBriefFinding[];
  privilegeMap: PrivilegeMap;
  artifactComparison: ArtifactComparison;
  policySnapshot: ManifestFields;
  evidenceIndex: Array<{
    checkKey: string;
    status: string;
    evidence: EvidenceRecord;
  }>;
  limitations: string[];
  markdown: string;
}

export interface DeepVerificationBundle {
  version: typeof PAID_BUNDLE_VERSION;
  features: [
    'multi_contract_privilege_map',
    'reviewed_artifact_comparison',
    'auditor_brief',
  ];
  privilegeMap: PrivilegeMap;
  artifactComparison: ArtifactComparison;
  auditorBrief: AuditorBrief;
}

interface PrivilegeRelation {
  from: Address;
  to: Address;
  relationship: string;
  label: string;
  role?: string;
  evidence: EvidenceRecord;
}

function cleanText(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function normalizeHash(value: unknown, field: string, errors: string[]): Hex | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    value.length !== 66 ||
    !isHex(value, { strict: true })
  ) {
    errors.push(`${field} must be a 32-byte 0x-prefixed hash.`);
    return null;
  }
  return value.toLowerCase() as Hex;
}

function artifactBytecode(input: ReviewedArtifactInput): string | null {
  if (typeof input.deployedBytecode === 'string') return input.deployedBytecode;
  if (
    input.deployedBytecode &&
    typeof input.deployedBytecode === 'object' &&
    typeof input.deployedBytecode.object === 'string'
  ) {
    return input.deployedBytecode.object;
  }
  return null;
}

export function resolveReviewedArtifact(
  input: ReviewedArtifactInput | undefined,
): ResolvedReviewedArtifact {
  if (!input) {
    return {
      provided: false,
      name: null,
      reviewedCommit: null,
      expectedRuntimeCodeHash: null,
      expectedImplementationAddress: null,
      expectedImplementationCodeHash: null,
      bytecodeHashComputed: null,
      errors: [],
    };
  }

  const errors: string[] = [];
  const implementationAddress = input.implementationAddress
    ? normalizeAddress(input.implementationAddress)
    : null;
  if (input.implementationAddress && !implementationAddress) {
    errors.push('reviewedArtifact.implementationAddress must be a valid EVM address.');
  }

  const runtimeHash = normalizeHash(
    input.runtimeCodeHash,
    'reviewedArtifact.runtimeCodeHash',
    errors,
  );
  const implementationHash = normalizeHash(
    input.implementationCodeHash,
    'reviewedArtifact.implementationCodeHash',
    errors,
  );

  let bytecodeHash: Hex | null = null;
  const bytecode = artifactBytecode(input);
  if (bytecode !== null) {
    if (
      bytecode.length < 4 ||
      bytecode.length > 1_048_578 ||
      bytecode.length % 2 !== 0 ||
      !isHex(bytecode, { strict: true })
    ) {
      errors.push(
        'reviewedArtifact.deployedBytecode must be valid 0x-prefixed runtime bytecode up to 512 KiB.',
      );
    } else {
      bytecodeHash = keccak256(bytecode as Hex);
    }
  }

  let expectedRuntimeCodeHash = runtimeHash;
  let expectedImplementationCodeHash = implementationHash;
  if (bytecodeHash) {
    if (implementationAddress) {
      if (implementationHash && implementationHash !== bytecodeHash) {
        errors.push(
          'reviewedArtifact.deployedBytecode hash conflicts with implementationCodeHash.',
        );
      }
      expectedImplementationCodeHash = implementationHash ?? bytecodeHash;
    } else {
      if (runtimeHash && runtimeHash !== bytecodeHash) {
        errors.push('reviewedArtifact.deployedBytecode hash conflicts with runtimeCodeHash.');
      }
      expectedRuntimeCodeHash = runtimeHash ?? bytecodeHash;
    }
  }

  return {
    provided: true,
    name: cleanText(input.name),
    reviewedCommit: cleanText(input.reviewedCommit, 160),
    expectedRuntimeCodeHash,
    expectedImplementationAddress: implementationAddress,
    expectedImplementationCodeHash,
    bytecodeHashComputed: bytecodeHash,
    errors,
  };
}

function resultCoverage(results: CheckResult[]): Coverage {
  const skipped = results.filter((result) => result.status === 'skipped');
  return {
    matched: results.filter((result) => result.status === 'matched').length,
    review: results.filter((result) => result.status === 'review').length,
    blocked: results.filter((result) => result.status === 'blocked').length,
    skipped: skipped.length,
    outOfScope: skipped.filter((result) => result.skipReason === 'out_of_scope').length,
    evidenceMissing: skipped.filter(
      (result) => result.skipReason === 'evidence_missing',
    ).length,
    total: results.length,
  };
}

function artifactCheck(
  checkKey: string,
  title: string,
  expected: string,
  actual: string | null,
  matches: boolean | null,
  evidence: EvidenceRecord,
  mismatchWhy: string,
  remediation: string,
): CheckResult {
  if (actual === null) {
    return {
      id: checkKey,
      checkKey,
      status: 'skipped',
      skipReason: 'evidence_missing',
      title,
      expected,
      actual: 'Not observable at the pinned block',
      evidence,
      why: 'A reviewed artifact value was supplied, but the corresponding onchain evidence is missing.',
      remediation,
      severity: 'high',
    };
  }
  return {
    id: checkKey,
    checkKey,
    status: matches ? 'matched' : 'blocked',
    title,
    expected,
    actual,
    evidence,
    why: matches ? undefined : mismatchWhy,
    remediation: matches ? undefined : remediation,
    severity: matches ? 'info' : 'critical',
  };
}

export function buildReviewedArtifactChecks(
  artifact: ResolvedReviewedArtifact,
  facts: ObservedFacts,
): CheckResult[] {
  if (!artifact.provided) return [];
  const checks: CheckResult[] = [];

  if (artifact.expectedRuntimeCodeHash) {
    const actual = facts.codeHash?.toLowerCase() ?? null;
    checks.push(
      artifactCheck(
        'reviewed_artifact_runtime_hash',
        'Reviewed artifact runtime code hash',
        artifact.expectedRuntimeCodeHash,
        actual,
        actual ? actual === artifact.expectedRuntimeCodeHash : null,
        {
          source: 'keccak256(root runtime bytecode)',
          block: facts.blockNumber,
          raw: actual ?? undefined,
        },
        'The deployed root runtime bytecode differs from the reviewed artifact.',
        'Deploy the reviewed runtime bytecode or update the reviewed artifact only after human review.',
      ),
    );
  }

  if (artifact.expectedImplementationAddress) {
    const actual = facts.implementation;
    checks.push(
      artifactCheck(
        'reviewed_artifact_implementation_address',
        'Reviewed implementation address',
        artifact.expectedImplementationAddress,
        actual,
        actual
          ? addressesEqual(artifact.expectedImplementationAddress, actual)
          : null,
        facts.upgradeEvidence ?? {
          source: 'EIP-1967 implementation slot',
          block: facts.blockNumber,
          raw: actual ?? undefined,
        },
        'The live proxy points to a different implementation than the reviewed artifact.',
        'Upgrade the proxy to the reviewed implementation or re-review the new implementation before approval.',
      ),
    );
  }

  if (artifact.expectedImplementationCodeHash) {
    const actual = facts.implementationCodeHash?.toLowerCase() ?? null;
    checks.push(
      artifactCheck(
        'reviewed_artifact_implementation_hash',
        'Reviewed implementation code hash',
        artifact.expectedImplementationCodeHash,
        actual,
        actual ? actual === artifact.expectedImplementationCodeHash : null,
        {
          source: 'keccak256(implementation runtime bytecode)',
          block: facts.blockNumber,
          raw: actual ?? undefined,
        },
        'The live implementation bytecode differs from the reviewed artifact.',
        'Deploy or select the reviewed implementation bytecode, then rerun verification.',
      ),
    );
  }

  return checks;
}

function pushRelation(
  relations: PrivilegeRelation[],
  input: Omit<PrivilegeRelation, 'to'> & { to: string | null | undefined },
): void {
  const to = normalizeAddress(input.to);
  if (!to) return;
  relations.push({ ...input, to });
}

function privilegeRelations(
  facts: ObservedFacts,
  explicitRelated: RelatedContractInput[] | undefined,
): PrivilegeRelation[] {
  const root = facts.contractAddress;
  const relations: PrivilegeRelation[] = [];
  const atBlock = (source: string, raw?: string): EvidenceRecord => ({
    source,
    block: facts.blockNumber,
    raw,
  });

  pushRelation(relations, {
    from: root,
    to: facts.deployer,
    relationship: 'deployed_by',
    label: 'deployer',
    evidence: atBlock('creation transaction', facts.deployTxHash ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.owner,
    relationship: 'owned_by',
    label: 'owner',
    evidence: atBlock(facts.ownerReadMethod ?? 'owner()', facts.owner ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.pendingOwner,
    relationship: 'pending_owner',
    label: 'pending owner',
    evidence: atBlock('pendingOwner()', facts.pendingOwner ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.proxyAdmin,
    relationship: 'proxy_admin',
    label: 'proxy admin',
    evidence: facts.upgradeEvidence ?? atBlock('EIP-1967 admin slot'),
  });
  pushRelation(relations, {
    from: root,
    to: facts.upgradeAuthority,
    relationship: 'upgrade_authority',
    label: 'upgrade authority',
    evidence: facts.upgradeEvidence ?? atBlock('proxy / owner authority inference'),
  });
  pushRelation(relations, {
    from: root,
    to: facts.implementation,
    relationship: 'delegates_to_implementation',
    label: 'implementation',
    evidence: facts.upgradeEvidence ?? atBlock('EIP-1967 implementation slot'),
  });
  pushRelation(relations, {
    from: root,
    to: facts.timelockAddress,
    relationship: 'controlled_by_timelock',
    label: 'timelock',
    evidence: facts.timelockEvidence ?? atBlock('getMinDelay() probe'),
  });
  pushRelation(relations, {
    from: root,
    to: facts.treasury,
    relationship: 'uses_treasury',
    label: 'treasury',
    evidence: atBlock('treasury()', facts.treasury ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.feeRecipient,
    relationship: 'pays_fees_to',
    label: 'fee recipient',
    evidence: atBlock('feeRecipient()', facts.feeRecipient ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.oracle,
    relationship: 'reads_oracle',
    label: 'oracle',
    evidence: atBlock('oracle()', facts.oracle ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.router,
    relationship: 'uses_router',
    label: 'router',
    evidence: atBlock('router()', facts.router ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.factory,
    relationship: 'uses_factory',
    label: 'factory',
    evidence: atBlock('factory()', facts.factory ?? undefined),
  });
  pushRelation(relations, {
    from: root,
    to: facts.pool,
    relationship: 'uses_pool',
    label: 'pool',
    evidence: atBlock('pool()', facts.pool ?? undefined),
  });

  for (const signer of facts.safeOwners ?? []) {
    pushRelation(relations, {
      from: facts.owner ?? root,
      to: signer,
      relationship: 'safe_signer',
      label: 'Safe signer',
      evidence: facts.safeEvidence ?? atBlock('Safe getOwners()'),
    });
  }
  for (const minter of facts.minterHolders ?? []) {
    pushRelation(relations, {
      from: root,
      to: minter,
      relationship: 'mint_authority',
      label: 'minter',
      role: 'MINTER_ROLE',
      evidence: atBlock('minter() / MINTER_ROLE', minter),
    });
  }
  for (const observation of facts.roles) {
    for (const holder of observation.holders) {
      pushRelation(relations, {
        from: root,
        to: holder,
        relationship: `access_role:${observation.role}`,
        label: observation.role,
        role: observation.role,
        evidence: observation.evidence,
      });
    }
  }

  for (const item of (explicitRelated ?? []).slice(0, 8)) {
    const raw = typeof item === 'string' ? item : item.address;
    const label =
      typeof item === 'string' ? 'request-supplied related contract' : cleanText(item.label, 80) ?? 'request-supplied related contract';
    pushRelation(relations, {
      from: root,
      to: raw,
      relationship: 'related_contract',
      label,
      evidence: atBlock('request.relatedContracts', raw),
    });
  }

  return relations;
}

export function privilegeProbeAddresses(
  facts: ObservedFacts,
  explicitRelated: RelatedContractInput[] | undefined,
): Address[] {
  const seen = new Set<string>([facts.contractAddress.toLowerCase()]);
  const out: Address[] = [];
  for (const relation of privilegeRelations(facts, explicitRelated)) {
    const key = relation.to.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(relation.to);
    if (out.length >= MAX_RELATED_CODE_PROBES) break;
  }
  return out;
}

export function buildPrivilegeMap(input: {
  facts: ObservedFacts;
  explicitRelated?: RelatedContractInput[];
  inspections: RelatedAddressInspection[];
}): PrivilegeMap {
  const { facts } = input;
  const relations = privilegeRelations(facts, input.explicitRelated);
  const inspections = new Map(
    input.inspections.map((item) => [item.address.toLowerCase(), item]),
  );
  const nodes = new Map<string, PrivilegeMapNode>();

  const ensureNode = (
    address: Address,
    label: string,
    role?: string,
  ): PrivilegeMapNode => {
    const key = address.toLowerCase();
    const inspection = inspections.get(key);
    let node = nodes.get(key);
    if (!node) {
      let kind: PrivilegeMapNode['kind'] = 'unknown';
      let codeHash: Hex | null = inspection?.codeHash ?? null;
      let bytecodeSize: number | null = inspection?.bytecodeSize ?? null;
      if (key === facts.contractAddress.toLowerCase()) {
        kind = facts.hasCode ? 'contract' : 'eoa';
        codeHash = facts.codeHash;
        bytecodeSize = null;
      } else if (inspection?.hasCode !== null && inspection?.hasCode !== undefined) {
        kind = inspection.hasCode ? 'contract' : 'eoa';
      } else if (facts.owner && key === facts.owner.toLowerCase() && facts.isOwnerContract !== null) {
        kind = facts.isOwnerContract ? 'contract' : 'eoa';
      }
      node = {
        address,
        kind,
        labels: [],
        roles: [],
        codeHash,
        bytecodeSize,
      };
      nodes.set(key, node);
    }
    if (!node.labels.includes(label)) node.labels.push(label);
    if (role && !node.roles.includes(role)) node.roles.push(role);
    return node;
  };

  ensureNode(facts.contractAddress, 'root deployment');
  for (const relation of relations) {
    ensureNode(relation.from, relation.from === facts.contractAddress ? 'root deployment' : 'authority');
    ensureNode(relation.to, relation.label, relation.role);
  }

  const edges: PrivilegeMapEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const relation of relations) {
    const key = `${relation.from.toLowerCase()}:${relation.to.toLowerCase()}:${relation.relationship}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      from: relation.from,
      to: relation.to,
      relationship: relation.relationship,
      evidence: relation.evidence,
    });
  }

  const unclassified = [...nodes.values()].filter((node) => node.kind === 'unknown').length;
  const limitations = [
    'Graph edges are derived from standard getters, EIP-1967 slots, Safe reads, and common AccessControl roles at the pinned block.',
    'Role enumeration is complete only when AccessControlEnumerable is exposed; otherwise common roles are probed against known privileged addresses.',
  ];
  if (unclassified > 0) {
    limitations.push(
      `${unclassified} discovered address(es) were not code-classified because the bounded probe limit is ${MAX_RELATED_CODE_PROBES}.`,
    );
  }

  return {
    rootAddress: facts.contractAddress,
    blockNumber: facts.blockNumber,
    nodes: [...nodes.values()],
    edges,
    discoveredAddressCount: nodes.size,
    codeProbedAddressCount: input.inspections.length,
    limitations,
  };
}

function artifactComparison(
  artifact: ResolvedReviewedArtifact,
  facts: ObservedFacts,
  checks: CheckResult[],
): ArtifactComparison {
  let status: ArtifactComparison['status'] = 'not_provided';
  if (artifact.provided) {
    status = checks.some((check) => check.status === 'blocked')
      ? 'blocked'
      : checks.some(
            (check) =>
              check.status === 'review' ||
              (check.status === 'skipped' && check.skipReason === 'evidence_missing'),
          )
        ? 'review_required'
        : checks.length > 0
          ? 'matched'
          : 'review_required';
  }
  return {
    status,
    artifactName: artifact.name,
    reviewedCommit: artifact.reviewedCommit,
    expected: {
      runtimeCodeHash: artifact.expectedRuntimeCodeHash,
      implementationAddress: artifact.expectedImplementationAddress,
      implementationCodeHash: artifact.expectedImplementationCodeHash,
    },
    actual: {
      runtimeCodeHash: facts.codeHash,
      implementationAddress: facts.implementation,
      implementationCodeHash: facts.implementationCodeHash,
    },
    checks: checks.map((check) => check.checkKey),
  };
}

function briefMarkdown(input: {
  reportId: string;
  projectName: string;
  facts: ObservedFacts;
  verdict: Verdict;
  coverage: Coverage;
  findings: AuditorBriefFinding[];
  privilegeMap: PrivilegeMap;
  artifactComparison: ArtifactComparison;
}): string {
  const lines: string[] = [
    `# Shomer Auditor Brief — ${cleanText(input.projectName, 100) ?? 'Deployment'}`,
    '',
    `Report: ${input.reportId}`,
    `Verdict: ${input.verdict}`,
    `Network: ${input.facts.network} (chain ${input.facts.chainId})`,
    `Contract: ${input.facts.contractAddress}`,
    `Evidence block: ${input.facts.blockNumber}`,
    '',
    '## Coverage',
    '',
    `Matched ${input.coverage.matched}; blocked ${input.coverage.blocked}; review ${input.coverage.review}; evidence missing ${input.coverage.evidenceMissing}; out of scope ${input.coverage.outOfScope}.`,
    '',
    '## Findings',
    '',
  ];
  if (input.findings.length === 0) {
    lines.push('No blockers or review items were produced for the defined policy checks.');
  } else {
    for (const finding of input.findings) {
      lines.push(
        `### ${finding.status.toUpperCase()} — ${finding.title}`,
        '',
        `- Expected: ${finding.expected}`,
        `- Actual: ${finding.actual}`,
      );
      if (finding.why) lines.push(`- Why it matters: ${finding.why}`);
      if (finding.remediation) lines.push(`- Remediation: ${finding.remediation}`);
      if (finding.evidence) {
        lines.push(
          `- Evidence: ${finding.evidence.source}${finding.evidence.txHash ? `; tx ${finding.evidence.txHash}` : ''}${finding.evidence.slot ? `; slot ${finding.evidence.slot}` : ''}`,
        );
      }
      lines.push('');
    }
  }
  lines.push(
    '## Privilege map',
    '',
    `${input.privilegeMap.discoveredAddressCount} addresses and ${input.privilegeMap.edges.length} relationships discovered; ${input.privilegeMap.codeProbedAddressCount} related addresses code-classified.`,
    '',
  );
  for (const edge of input.privilegeMap.edges) {
    lines.push(`- ${edge.from} —${edge.relationship}→ ${edge.to}`);
  }
  lines.push(
    '',
    '## Reviewed artifact',
    '',
    `Comparison status: ${input.artifactComparison.status}.`,
    '',
    '## Scope statement',
    '',
    'Shomer compares declared policy and reviewed artifact values to observable onchain state at a specific block. This is not a security audit and does not claim the deployment is safe, correct, or free of vulnerabilities.',
  );
  return lines.join('\n');
}

export function buildDeepVerificationBundle(input: {
  manifest: ManifestFields;
  facts: ObservedFacts;
  coreResults: CheckResult[];
  artifact: ResolvedReviewedArtifact;
  artifactChecks: CheckResult[];
  privilegeMap: PrivilegeMap;
}): { bundle: DeepVerificationBundle; results: CheckResult[]; verdict: Verdict; coverage: Coverage } {
  const results = [...input.coreResults, ...input.artifactChecks];
  const verdict = verdictOf(results);
  const coverage = resultCoverage(results);
  const comparison = artifactComparison(input.artifact, input.facts, input.artifactChecks);
  const findings: AuditorBriefFinding[] = results
    .filter(
      (result) =>
        result.status === 'blocked' ||
        result.status === 'review' ||
        (result.status === 'skipped' && result.skipReason === 'evidence_missing'),
    )
    .map((result) => ({
      checkKey: result.checkKey,
      status: result.status,
      severity: result.severity,
      title: result.title,
      expected: result.expected,
      actual: result.actual,
      why: result.why,
      remediation: result.remediation,
      evidence: result.evidence,
    }));
  const digestPayload = JSON.stringify({
    version: PAID_BUNDLE_VERSION,
    chainId: input.facts.chainId,
    blockNumber: input.facts.blockNumber,
    contractAddress: input.facts.contractAddress,
    verdict,
    policy: input.manifest,
    results: results.map((result) => ({
      checkKey: result.checkKey,
      status: result.status,
      expected: result.expected,
      actual: result.actual,
      evidence: result.evidence,
    })),
    privilegeEdges: input.privilegeMap.edges,
    artifact: comparison,
  });
  const contentDigest = keccak256(stringToHex(digestPayload));
  const reportId = `shomer-${input.facts.chainId}-${input.facts.blockNumber}-${contentDigest.slice(2, 14)}`;
  const evidenceIndex = results.map((result) => ({
    checkKey: result.checkKey,
    status: result.status,
    evidence: result.evidence,
  }));
  const limitations = [
    ...input.facts.readErrors.slice(0, 12),
    ...input.privilegeMap.limitations,
    'Only declared policies and deterministically observable facts are evaluated; no vulnerability claims are generated.',
  ];
  const auditorBriefBase = {
    format: 'shomer-auditor-brief/v1' as const,
    reportId,
    contentDigest,
    generatedAt: new Date().toISOString(),
    observedAt: new Date(input.facts.timestamp * 1000).toISOString(),
    projectName: input.manifest.projectName,
    scope: {
      network: input.facts.network,
      chainId: input.facts.chainId,
      blockNumber: input.facts.blockNumber,
      contractAddress: input.facts.contractAddress,
    },
    verdict,
    coverage,
    findings,
    privilegeMap: input.privilegeMap,
    artifactComparison: comparison,
    policySnapshot: { ...input.manifest },
    evidenceIndex,
    limitations,
  };
  const markdown = briefMarkdown({
    reportId,
    projectName: input.manifest.projectName,
    facts: input.facts,
    verdict,
    coverage,
    findings,
    privilegeMap: input.privilegeMap,
    artifactComparison: comparison,
  });
  const auditorBrief: AuditorBrief = { ...auditorBriefBase, markdown };

  return {
    results,
    verdict,
    coverage,
    bundle: {
      version: PAID_BUNDLE_VERSION,
      features: [
        'multi_contract_privilege_map',
        'reviewed_artifact_comparison',
        'auditor_brief',
      ],
      privilegeMap: input.privilegeMap,
      artifactComparison: comparison,
      auditorBrief,
    },
  };
}
