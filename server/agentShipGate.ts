/**
 * Free-tier composite ship-gate for agents.
 * Separate module avoids circular imports with agentVerify ↔ agentTools.
 */
import { policyHash } from '../src/lib/policy/policyHash';
import { emptyManifest, type ManifestFields } from '../src/lib/policy/types';
import { normalizeAddress } from '../src/lib/utils/address';
import { runAgentVerify, type AgentVerifyRequest } from './agentVerify';
import { runAgentCreateDraft } from './agentTools';

function parseNetwork(n: unknown): 'mainnet' | 'testnet' {
  return n === 'testnet' ? 'testnet' : 'mainnet';
}

/**
 * Ship gate: optional pack draft (fill from live) + free verify.
 * Never runs paid Deep Verification. Never auto-approves.
 */
export async function runAgentShipGate(input: {
  network?: string;
  contractAddress: string;
  packId?: string;
  policy?: Partial<ManifestFields>;
  projectName?: string;
  fillFromLive?: boolean;
  blockNumber?: number | string;
  options?: AgentVerifyRequest['options'];
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

  let draft: ManifestFields | null = null;
  let packId: string | null = null;
  let policyForVerify: Partial<ManifestFields> | undefined = input.policy;

  if (input.packId) {
    const drafted = await runAgentCreateDraft({
      packId: input.packId,
      network,
      contractAddress: addr,
      projectName: input.projectName,
      fillFromLive: input.fillFromLive !== false,
      overrides: input.policy,
      blockNumber: input.blockNumber,
    });
    if (!drafted.body.ok) {
      return { status: drafted.status, body: drafted.body };
    }
    draft = drafted.body.draft as ManifestFields;
    packId = String(drafted.body.packId ?? input.packId);
    if (input.usePackAsPolicy !== false && draft) {
      policyForVerify = draft;
    }
  }

  const verified = await runAgentVerify(
    {
      network,
      contractAddress: addr,
      policy: policyForVerify,
      projectName: input.projectName,
      blockNumber: input.blockNumber,
      options: input.options,
    },
    'free',
  );

  const body = { ...verified.body } as Record<string, unknown>;
  const manifestForHash = emptyManifest({
    ...(policyForVerify ?? {}),
    network,
    contractAddress: addr,
    projectName:
      input.projectName?.trim() ||
      policyForVerify?.projectName ||
      'Ship gate',
  });
  const usedPolicyHash = policyHash(manifestForHash);
  const verdict = body.verdict as string | undefined;

  return {
    status: verified.status,
    body: {
      ...body,
      tool: 'ship_gate',
      tier: 'free',
      packId,
      draft,
      draftStatus: draft ? 'draft_only' : null,
      policyHash: usedPolicyHash,
      shipGate: {
        allowed: body.ok === true && verdict !== 'blocked',
        verdict,
        recommendation:
          verdict === 'blocked'
            ? 'DO_NOT_SHIP — policy mismatch (Blocked)'
            : verdict === 'policy_matched'
              ? 'SHIP_GATE_CLEAR — Policy Matched (still not an audit; never "safe")'
              : 'REVIEW_REQUIRED — resolve review items before treating as approved',
        note: 'Free ship-gate only. For privilege map + reviewed artifact + auditor brief use paid POST /api/agent/verify/paid (x402). Drafts are never auto-approved.',
      },
      freeVsPaid: {
        thisEndpoint: 'free — ship_gate (optional pack draft + verify)',
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
