/**
 * Shared A2MCP verify logic for free + paid agent endpoints.
 * Reuses real X Layer adapter + pure policy engine — never fabricates.
 */
import {
  inspectRelatedAddresses,
  readFacts,
} from '../src/lib/adapters/xlayer';
import {
  runPolicyChecks,
  type PolicyCheckOptions,
  type UndeclaredObservedMode,
} from '../src/lib/policy/engine';
import {
  emptyManifest,
  type EvidenceRecord,
  type ManifestFields,
  type NetworkId,
  type ObservedFacts,
} from '../src/lib/policy/types';
import {
  listPolicyPresets,
  resolvePolicyPreset,
} from '../src/lib/policy/presets';
import { normalizeAddress } from '../src/lib/utils/address';
import { policyHash } from '../src/lib/policy/policyHash';
import { suggestedProjectName } from '../src/lib/utils/tokenLabel';
import { packsCatalogSlice } from './agentTools';
import { listPolicyPacks } from '../src/lib/policy/packs';
import {
  buildDeepVerificationBundle,
  buildPrivilegeMap,
  buildReviewedArtifactChecks,
  privilegeProbeAddresses,
  resolveReviewedArtifact,
  type DeepVerificationBundle,
  type RelatedContractInput,
  type ReviewedArtifactInput,
} from './paidVerification';

export interface AgentVerifyOptions {
  /**
   * Observed-but-undeclared field handling.
   * Default `review`. Use `out_of_scope` to reduce agent noise (never hides mismatches).
   */
  undeclaredObserved?: UndeclaredObservedMode;
  /** Include per-check evidence objects (default true). */
  includeEvidence?: boolean;
}

export interface AgentVerifyRequest {
  network?: NetworkId | string;
  contractAddress: string;
  /** Optional partial policy. Missing fields stay out of scope. */
  policy?: Partial<ManifestFields>;
  /** Named preset merged under explicit policy fields. */
  policyPreset?: string;
  projectName?: string;
  /** Pin reads to this block (≤ head). Omit for latest. */
  blockNumber?: number | string;
  options?: AgentVerifyOptions;
  /** Paid: reviewed runtime artifact / hashes to compare with live bytecode. */
  reviewedArtifact?: ReviewedArtifactInput;
  /** Paid alias for reviewedArtifact. */
  deploymentArtifact?: ReviewedArtifactInput;
  /** Paid: optional explicitly related contracts to add to the privilege map. */
  relatedContracts?: RelatedContractInput[];
}

export interface AgentCheckResult {
  checkKey: string;
  status: string;
  skipReason?: string;
  title: string;
  expected: string;
  actual: string;
  why?: string;
  remediation?: string;
  severity?: string;
  evidence?: EvidenceRecord;
}

export interface AgentVerifyResponse {
  ok: boolean;
  service: 'shomer';
  tier: 'free' | 'paid';
  network: NetworkId;
  chainId: number;
  contractAddress: string;
  blockNumber: number;
  /** Echo of request pin when provided. */
  requestedBlock?: number;
  verdict: 'blocked' | 'review_required' | 'policy_matched';
  coverage: {
    matched: number;
    review: number;
    blocked: number;
    skipped: number;
    outOfScope: number;
    evidenceMissing: number;
    total: number;
  };
  results: AgentCheckResult[];
  facts: {
    owner: string | null;
    pendingOwner: string | null;
    isSafe: boolean | null;
    safeThreshold: number | null;
    safeOwners: string[] | null;
    isProxy: boolean | null;
    proxyKind: string | null;
    implementation: string | null;
    upgradeAuthority: string | null;
    upgradeAuthorityIsSafe: boolean | null;
    timelockMinDelaySec: number | null;
    initializerSealed: boolean | null;
    totalSupply: string | null;
    tokenName: string | null;
    tokenSymbol: string | null;
    minterHolders: string[] | null;
    oracle: string | null;
    oracleUpdatedAt: number | null;
    feeBps: number | null;
    deployer: string | null;
    deployTxHash: string | null;
    codeHash: string | null;
    hasCode: boolean;
    verification: string;
    readErrors: string[];
  };
  policyPresetApplied?: string | null;
  optionsApplied?: {
    undeclaredObserved: UndeclaredObservedMode;
    includeEvidence: boolean;
  };
  /** Present only on a successful paid Deep Verification call. */
  deepVerification?: DeepVerificationBundle;
  /** keccak of policy snapshot used for this verify */
  policyHash?: string;
  disclaimer: string;
  error?: string;
  message?: string;
}

const DISCLAIMER =
  'Shomer compares declared policy to observable onchain state at a specific block. This is not a security audit and does not claim the contract is safe, correct, or free of vulnerabilities.';

const RAW_CAP = 480;

function capEvidence(ev: EvidenceRecord): EvidenceRecord {
  const out: EvidenceRecord = { ...ev };
  if (out.raw && out.raw.length > RAW_CAP) {
    out.raw = out.raw.slice(0, RAW_CAP - 1) + '…';
  }
  if (out.note && out.note.length > RAW_CAP) {
    out.note = out.note.slice(0, RAW_CAP - 1) + '…';
  }
  return out;
}

function emptyFacts(): AgentVerifyResponse['facts'] {
  return {
    owner: null,
    pendingOwner: null,
    isSafe: null,
    safeThreshold: null,
    safeOwners: null,
    isProxy: null,
    proxyKind: null,
    implementation: null,
    upgradeAuthority: null,
    upgradeAuthorityIsSafe: null,
    timelockMinDelaySec: null,
    initializerSealed: null,
    totalSupply: null,
    tokenName: null,
    tokenSymbol: null,
    minterHolders: null,
    oracle: null,
    oracleUpdatedAt: null,
    feeBps: null,
    deployer: null,
    deployTxHash: null,
    codeHash: null,
    hasCode: false,
    verification: 'unknown',
    readErrors: [],
  };
}

function emptyCoverage(): AgentVerifyResponse['coverage'] {
  return {
    matched: 0,
    review: 0,
    blocked: 0,
    skipped: 0,
    outOfScope: 0,
    evidenceMissing: 0,
    total: 0,
  };
}

export function parseNetwork(n: unknown): NetworkId {
  return n === 'testnet' ? 'testnet' : 'mainnet';
}

function parseBlockPin(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error('blockNumber must be a non-negative integer');
  }
  return n;
}

function parseOptions(raw: AgentVerifyOptions | undefined): {
  check: PolicyCheckOptions;
  includeEvidence: boolean;
  undeclaredObserved: UndeclaredObservedMode;
} {
  const undeclaredObserved: UndeclaredObservedMode =
    raw?.undeclaredObserved === 'out_of_scope' ? 'out_of_scope' : 'review';
  const includeEvidence = raw?.includeEvidence !== false;
  return {
    check: { undeclaredObserved },
    includeEvidence,
    undeclaredObserved,
  };
}

export type RunAgentVerifyOptions = {
  /**
   * Reuse a preloaded ObservedFacts snapshot (same block) to avoid a second
   * full chain read — used by ship-gate composite.
   */
  facts?: ObservedFacts;
};

export async function runAgentVerify(
  input: AgentVerifyRequest,
  tier: 'free' | 'paid',
  runOpts?: RunAgentVerifyOptions,
): Promise<{ status: number; body: AgentVerifyResponse }> {
  const network = parseNetwork(input.network);
  const addr = normalizeAddress(input.contractAddress ?? '');
  const opts = parseOptions(input.options);
  let requestedBlock: number | undefined;
  try {
    requestedBlock = parseBlockPin(input.blockNumber);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      status: 400,
      body: {
        ok: false,
        service: 'shomer',
        tier,
        network,
        chainId: network === 'mainnet' ? 196 : 1952,
        contractAddress: String(input.contractAddress ?? ''),
        blockNumber: 0,
        verdict: 'review_required',
        coverage: emptyCoverage(),
        results: [],
        facts: emptyFacts(),
        disclaimer: DISCLAIMER,
        error: 'invalid_block',
        message,
      },
    };
  }

  if (!addr) {
    return {
      status: 400,
      body: {
        ok: false,
        service: 'shomer',
        tier,
        network,
        chainId: network === 'mainnet' ? 196 : 1952,
        contractAddress: String(input.contractAddress ?? ''),
        blockNumber: 0,
        requestedBlock,
        verdict: 'review_required',
        coverage: emptyCoverage(),
        results: [],
        facts: emptyFacts(),
        disclaimer: DISCLAIMER,
        error: 'invalid_address',
        message: 'contractAddress must be a valid 0x EVM address.',
      },
    };
  }

  const reviewedArtifact = resolveReviewedArtifact(
    tier === 'paid'
      ? input.reviewedArtifact ?? input.deploymentArtifact
      : undefined,
  );
  if (reviewedArtifact.errors.length > 0) {
    return {
      status: 400,
      body: {
        ok: false,
        service: 'shomer',
        tier,
        network,
        chainId: network === 'mainnet' ? 196 : 1952,
        contractAddress: addr,
        blockNumber: 0,
        requestedBlock,
        verdict: 'review_required',
        coverage: emptyCoverage(),
        results: [],
        facts: emptyFacts(),
        disclaimer: DISCLAIMER,
        error: 'invalid_reviewed_artifact',
        message: reviewedArtifact.errors.join(' '),
      },
    };
  }

  try {
    const facts =
      runOpts?.facts ??
      (await readFacts({
        network,
        contractAddress: addr,
        blockNumber: requestedBlock,
      }));
    const preset = resolvePolicyPreset(input.policyPreset);
    const presetId = preset ? input.policyPreset!.trim().toLowerCase().replace(/-/g, '_') : null;
    if (input.policyPreset && !preset) {
      return {
        status: 400,
        body: {
          ok: false,
          service: 'shomer',
          tier,
          network,
          chainId: network === 'mainnet' ? 196 : 1952,
          contractAddress: addr,
          blockNumber: 0,
          requestedBlock,
          verdict: 'review_required',
          coverage: emptyCoverage(),
          results: [],
          facts: emptyFacts(),
          disclaimer: DISCLAIMER,
          error: 'invalid_preset',
          message: `Unknown policyPreset. Supported: ${listPolicyPresets().join(', ')}`,
        },
      };
    }
    const manifest = emptyManifest({
      ...(preset ?? {}),
      ...input.policy,
      projectName:
        input.projectName?.trim() ||
        input.policy?.projectName ||
        suggestedProjectName(facts.tokenName, facts.tokenSymbol) ||
        'Agent verify',
      network,
      contractAddress: addr,
    });

    const core = runPolicyChecks(
      manifest,
      facts,
      opts.check,
    );

    let results = core.results;
    let verdict = core.verdict;
    let coverage = core.coverage;
    let deepVerification: DeepVerificationBundle | undefined;

    if (tier === 'paid') {
      const artifactChecks = buildReviewedArtifactChecks(
        reviewedArtifact,
        facts,
      );
      const probeAddresses = privilegeProbeAddresses(
        facts,
        input.relatedContracts,
      );
      const inspections = await inspectRelatedAddresses({
        network,
        addresses: probeAddresses,
        blockNumber: facts.blockNumber,
      });
      const privilegeMap = buildPrivilegeMap({
        facts,
        explicitRelated: input.relatedContracts,
        inspections,
      });
      const deep = buildDeepVerificationBundle({
        manifest,
        facts,
        coreResults: core.results,
        artifact: reviewedArtifact,
        artifactChecks,
        privilegeMap,
      });
      results = deep.results;
      verdict = deep.verdict;
      coverage = deep.coverage;
      deepVerification = deep.bundle;
    }

    return {
      status: 200,
      body: {
        ok: true,
        service: 'shomer',
        tier,
        network: facts.network,
        chainId: facts.chainId,
        contractAddress: facts.contractAddress,
        blockNumber: facts.blockNumber,
        requestedBlock,
        verdict,
        coverage,
        results: results.map((r) => {
          const row: AgentCheckResult = {
            checkKey: r.checkKey,
            status: r.status,
            skipReason: r.skipReason,
            title: r.title,
            expected: r.expected,
            actual: r.actual,
            why: r.why,
            remediation: r.remediation,
            severity: r.severity,
          };
          if (opts.includeEvidence) {
            row.evidence = capEvidence(r.evidence);
          }
          return row;
        }),
        facts: {
          owner: facts.owner,
          pendingOwner: facts.pendingOwner,
          isSafe: facts.isSafe,
          safeThreshold: facts.safeThreshold,
          safeOwners: facts.safeOwners,
          isProxy: facts.isProxy,
          proxyKind: facts.proxyKind,
          implementation: facts.implementation,
          upgradeAuthority: facts.upgradeAuthority,
          upgradeAuthorityIsSafe: facts.upgradeAuthorityIsSafe,
          timelockMinDelaySec: facts.timelockMinDelaySec,
          initializerSealed: facts.initializerSealed,
          totalSupply: facts.totalSupply,
          tokenName: facts.tokenName,
          tokenSymbol: facts.tokenSymbol,
          minterHolders: facts.minterHolders,
          oracle: facts.oracle,
          oracleUpdatedAt: facts.oracleUpdatedAt,
          feeBps: facts.feeBps,
          deployer: facts.deployer,
          deployTxHash: facts.deployTxHash,
          codeHash: facts.codeHash,
          hasCode: facts.hasCode,
          verification: facts.verification.status,
          readErrors: facts.readErrors.slice(0, 12),
        },
        policyPresetApplied: presetId,
        optionsApplied: {
          undeclaredObserved: opts.undeclaredObserved,
          includeEvidence: opts.includeEvidence,
        },
        deepVerification,
        policyHash: policyHash(manifest),
        disclaimer: DISCLAIMER,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isClient =
      /invalid block|ahead of chain|Invalid contract|must be a non-negative/i.test(
        msg,
      );
    return {
      status: isClient ? 400 : 502,
      body: {
        ok: false,
        service: 'shomer',
        tier,
        network,
        chainId: network === 'mainnet' ? 196 : 1952,
        contractAddress: addr,
        blockNumber: 0,
        requestedBlock,
        verdict: 'review_required',
        coverage: emptyCoverage(),
        results: [],
        facts: emptyFacts(),
        disclaimer: DISCLAIMER,
        error: isClient ? 'bad_request' : 'verify_failed',
        message: msg,
      },
    };
  }
}

export function agentServiceCatalog(baseUrl: string) {
  return {
    service: 'shomer',
    name: 'Shomer — X Layer Ship Gate · deployment policy verification',
    aspId: '6117',
    marketplace: 'OKX.AI',
    description:
      'X Layer Ship Gate: agents verify live deployments against approved policy before shipping. Free: packs, read, draft, verify, ship-gate. Paid Deep Verification: privilege map, reviewed artifact/code-hash, auditor brief (x402 USDC on eip155:196). Not an audit; never claims safe.',
    tags: ['xlayer', 'policy', 'deployment', 'verification', 'a2mcp', 'x402'],
    network: 'X Layer mainnet (196) and testnet (1952)',
    policyPresets: listPolicyPresets(),
    policyPacks: listPolicyPacks().map((p) => ({ id: p.id, title: p.title, description: p.description, fields: p.fields })),
    ...packsCatalogSlice(),
    endpoints: [
      {
        path: '/api/agent/verify',
        method: 'POST',
        tier: 'free',
        pricing: 'free',
        description:
          'FREE Ship Gate verify: verdict, coverage, per-check evidence, facts, policyHash. No privilege map / auditor brief (those are paid).',
        body: {
          network: 'mainnet | testnet',
          contractAddress: '0x…',
          policy: 'optional partial Launch Manifest fields',
          policyPreset: 'optional: non_upgradeable | ownable | safe_owned_proxy | immutable_token',
          projectName: 'optional string',
          blockNumber: 'optional integer — pin reads to this block',
          options: {
            undeclaredObserved: 'review | out_of_scope (default review)',
            includeEvidence: 'boolean (default true)',
          },
        },
        url: `${baseUrl}/api/agent/verify`,
      },
      {
        path: '/api/agent/verify/paid',
        method: 'POST',
        tier: 'paid',
        pricing: process.env.X402_PRICE_USD ?? '0.01',
        currency: 'USDC',
        payment: 'x402',
        settlementNetwork: process.env.X402_NETWORK?.trim() || 'xlayer (eip155:196)',
        description:
          'Paid Deep Verification on X Layer: bounded multi-contract privilege map, reviewed runtime artifact/code-hash comparison, and an auditor-ready JSON + Markdown evidence brief. Without payment returns HTTP 402 + PAYMENT-REQUIRED (USDC on eip155:196).',
        body: {
          network: 'mainnet | testnet',
          contractAddress: '0x…',
          policy: 'optional partial Launch Manifest fields',
          blockNumber: 'optional integer',
          options: 'same as free',
          reviewedArtifact:
            'optional { name, reviewedCommit, runtimeCodeHash, implementationAddress, implementationCodeHash, deployedBytecode }',
          relatedContracts:
            'optional array of addresses or { address, label } (up to 8 request-supplied entries)',
        },
        url: `${baseUrl}/api/agent/verify/paid`,
      },
    ],
    disclaimer: DISCLAIMER,
  };
}
