/**
 * Free-tier composite ship-gate for agents.
 *
 * Integrity rules:
 * 1) Never verify against a policy that was only copied from the same live deployment
 *    (fillFromLive produces a founder-facing draft only).
 * 2) Explicit policy fields always win over pack defaults and live import.
 * 3) shipGate.allowed is true only for policy_matched + an explicit approved policy body.
 * 4) One chain read is shared across draft fill + verify.
 */
import { readFacts } from '../src/lib/adapters/xlayer';
import { policyHash } from '../src/lib/policy/policyHash';
import { seedDraftFromPack } from '../src/lib/policy/packs';
import {
  emptyManifest,
  type ManifestFields,
  type ObservedFacts,
} from '../src/lib/policy/types';
import { normalizeAddress } from '../src/lib/utils/address';
import { runAgentVerify, type AgentVerifyRequest } from './agentVerify';
import { runAgentCreateDraft } from './agentTools';

function parseNetwork(n: unknown): 'mainnet' | 'testnet' {
  return n === 'testnet' ? 'testnet' : 'mainnet';
}

/** Hard fields that count as an explicitly supplied policy (not empty pack defaults alone). */
const SUBSTANTIVE_KEYS: (keyof ManifestFields)[] = [
  'owner',
  'expectedSafe',
  'expectedDeployer',
  'expectedProxyAdminOrUpgradeAuthority',
  'expectedImplementation',
  'expectedImplementationCodeHash',
  'minMultisigThreshold',
  'minTimelockDelaySec',
  'treasury',
  'feeRecipient',
  'maxTokenSupply',
  'oracle',
  'approvedRouters',
  'approvedFactories',
  'approvedPools',
  'maxFeeBps',
  'maxSlippageBps',
  'maxOracleStalenessSec',
];

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'boolean') return false;
  if (typeof v === 'number') return false;
  return false;
}

/**
 * Caller supplied an explicit policy they treat as approved (not live-imported draft).
 * Requires either approvedPolicy: true with substantive fields, or substantive policy fields.
 */
export function hasExplicitApprovedPolicy(
  policy: Partial<ManifestFields> | undefined,
  approvedPolicyFlag?: boolean,
): boolean {
  if (!policy || typeof policy !== 'object') return false;
  const hasSubstantive = SUBSTANTIVE_KEYS.some((k) => !isEmptyValue(policy[k]));
  // upgradeable alone is not enough (pack defaults set it)
  if (!hasSubstantive) return false;
  // Prefer explicit flag; if omitted, substantive policy still counts as explicit
  if (approvedPolicyFlag === false) return false;
  return true;
}

/**
 * Policy used for verification: pack defaults + explicit policy only.
 * Never includes live-imported addresses from the same deployment.
 */
function buildVerificationPolicy(input: {
  packId?: string;
  network: 'mainnet' | 'testnet';
  contractAddress: string;
  projectName?: string;
  policy?: Partial<ManifestFields>;
}): ManifestFields {
  if (input.packId) {
    const seeded = seedDraftFromPack({
      packId: input.packId,
      network: input.network,
      contractAddress: input.contractAddress,
      projectName: input.projectName ?? '',
      overrides: input.policy,
    });
    if (seeded.ok) return seeded.draft;
  }
  return emptyManifest({
    ...(input.policy ?? {}),
    network: input.network,
    contractAddress: input.contractAddress,
    projectName: input.projectName?.trim() || input.policy?.projectName || 'Ship gate',
  });
}

export async function runAgentShipGate(input: {
  network?: string;
  contractAddress: string;
  packId?: string;
  policy?: Partial<ManifestFields>;
  /**
   * Caller asserts `policy` is an approved snapshot (founder-locked), not a live import.
   * Required for shipGate.allowed === true together with policy_matched.
   */
  approvedPolicy?: boolean;
  projectName?: string;
  /**
   * If true, also build a founder-facing draft filled from live (suggestion only).
   * Default false — live fill is never used as the verification policy.
   */
  fillFromLive?: boolean;
  blockNumber?: number | string;
  options?: AgentVerifyRequest['options'];
  /** @deprecated Ignored. Live-filled drafts are never used for verification. */
  usePackAsPolicy?: boolean;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const network = parseNetwork(input.network);
  const addr = normalizeAddress(input.contractAddress ?? '');
  if (!addr) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'invalid_address',
        message: 'contractAddress must be a valid 0x EVM address.',
      },
    };
  }

  // Single chain read for the whole composite request
  let facts: ObservedFacts;
  let requestedBlock: number | undefined;
  try {
    if (input.blockNumber !== undefined && input.blockNumber !== null && input.blockNumber !== '') {
      const n = Number(input.blockNumber);
      if (!Number.isInteger(n) || n < 0) {
        return {
          status: 400,
          body: {
            ok: false,
            error: 'invalid_block',
            message: 'blockNumber must be a non-negative integer',
          },
        };
      }
      requestedBlock = n;
    }
    facts = await readFacts({
      network,
      contractAddress: addr,
      blockNumber: requestedBlock,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: /invalid|ahead of chain/i.test(msg) ? 400 : 502,
      body: { ok: false, error: 'read_failed', message: msg },
    };
  }

  // Optional founder-facing draft (live fill). Never used as verify policy.
  let draft: ManifestFields | null = null;
  let packId: string | null = null;
  let draftStatus: string | null = null;
  const wantSuggestedDraft = Boolean(input.packId) || input.fillFromLive === true;

  if (wantSuggestedDraft && input.packId) {
    const drafted = await runAgentCreateDraft({
      packId: input.packId,
      network,
      contractAddress: addr,
      projectName: input.projectName,
      // Only fill from live when explicitly requested (default false)
      fillFromLive: input.fillFromLive === true,
      overrides: input.policy,
      blockNumber: requestedBlock,
      facts, // reuse snapshot
    });
    if (!drafted.body.ok) {
      return { status: drafted.status, body: drafted.body };
    }
    draft = drafted.body.draft as ManifestFields;
    packId = String(drafted.body.packId ?? input.packId);
    draftStatus = 'draft_only';
  }

  // Verification policy: pack defaults + explicit policy ONLY (never live-copied alone)
  const policyForVerify = buildVerificationPolicy({
    packId: input.packId,
    network,
    contractAddress: addr,
    projectName: input.projectName,
    policy: input.policy,
  });

  const explicitApproved = hasExplicitApprovedPolicy(
    input.policy,
    input.approvedPolicy,
  );

  const verified = await runAgentVerify(
    {
      network,
      contractAddress: addr,
      policy: policyForVerify,
      projectName: input.projectName,
      blockNumber: facts.blockNumber, // pin verify to the same snapshot block
      options: input.options,
    },
    'free',
    { facts }, // same ObservedFacts — no second full read
  );

  const body = { ...verified.body } as Record<string, unknown>;
  const verdict = body.verdict as string | undefined;
  const usedPolicyHash = policyHash(policyForVerify);

  const matched = body.ok === true && verdict === 'policy_matched';
  const allowed = matched && explicitApproved;

  let recommendation: string;
  if (verdict === 'blocked') {
    recommendation = 'DO_NOT_SHIP — policy mismatch (Blocked)';
  } else if (allowed) {
    recommendation =
      'SHIP_GATE_CLEAR — Policy Matched against an explicit approved policy (still not an audit; never "safe")';
  } else if (verdict === 'policy_matched' && !explicitApproved) {
    recommendation =
      'NOT_CLEARED — matched only against pack defaults / incomplete policy. Supply approvedPolicy:true with your locked policy fields.';
  } else if (verdict === 'review_required') {
    recommendation =
      'REVIEW_REQUIRED — not clear to ship; resolve review / evidence gaps first';
  } else {
    recommendation = 'NOT_CLEARED — ship gate did not clear';
  }

  return {
    status: verified.status,
    body: {
      ...body,
      tool: 'ship_gate',
      tier: 'free',
      packId,
      draft,
      draftStatus,
      /** Policy actually used for the verdict (never live-only import). */
      verificationPolicy: policyForVerify,
      policyHash: usedPolicyHash,
      observedBlock: facts.blockNumber,
      chainReads: 1,
      shipGate: {
        allowed,
        verdict,
        explicitApprovedPolicy: explicitApproved,
        recommendation,
        note:
          'allowed=true only when verdict is policy_matched AND an explicit approved policy was supplied. Live fill is draft-only and never becomes the verification policy. Free ship-gate only — paid Deep Verification is POST /api/agent/verify/paid.',
      },
      freeVsPaid: {
        thisEndpoint: 'free — ship_gate (one chain read; optional suggested draft + verify)',
        free: [
          'GET /api/agent/packs',
          'POST /api/agent/read',
          'POST /api/agent/draft',
          'POST /api/agent/verify',
          'POST /api/agent/ship-gate',
        ],
        paid: [
          'POST /api/agent/verify/paid — Deep Verification (privilegeMap, artifactComparison, auditorBrief)',
        ],
      },
    },
  };
}
