/**
 * Agent workflow tools beyond verify:
 * - read_deployment_state
 * - list_policy_packs
 * - create_policy_draft
 */
import { readFacts } from '../src/lib/adapters/xlayer';
import { draftFieldsFromFacts } from '../src/lib/policy/importFromFacts';
import {
  getPolicyPack,
  listPolicyPacks,
  seedDraftFromPack,
  type PolicyPackId,
} from '../src/lib/policy/packs';
import { emptyManifest, type ManifestFields, type NetworkId, type ObservedFacts } from '../src/lib/policy/types';
import { suggestedProjectName } from '../src/lib/utils/tokenLabel';
import { normalizeAddress } from '../src/lib/utils/address';
import { parseAgentNetwork } from './agentInput';

const DISCLAIMER =
  'Shomer reads observable onchain state and drafts policy. This is not a security audit and does not claim the contract is safe. Drafts are never approved automatically.';

export function listPacksResponse() {
  return {
    ok: true as const,
    service: 'shomer',
    tool: 'list_policy_packs',
    packs: listPolicyPacks().map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      fields: p.fields,
      defaults: p.defaults,
    })),
    note: 'Selecting a pack creates a draft only — never an approved policy. Founder must Approve vN before verify.',
    disclaimer: DISCLAIMER,
  };
}

export async function runAgentRead(input: {
  network?: string;
  contractAddress: string;
  blockNumber?: number | string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  let network: NetworkId;
  try {
    network = parseAgentNetwork(input.network);
  } catch (error) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'invalid_network',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
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

  let blockNumber: number | undefined;
  if (input.blockNumber !== undefined && input.blockNumber !== null && input.blockNumber !== '') {
    const n = Number(input.blockNumber);
    if (!Number.isInteger(n) || n < 0) {
      return {
        status: 400,
        body: { ok: false, error: 'invalid_block', message: 'blockNumber must be a non-negative integer' },
      };
    }
    blockNumber = n;
  }

  try {
    const facts = await readFacts({ network, contractAddress: addr, blockNumber });
    return {
      status: 200,
      body: {
        ok: true,
        service: 'shomer',
        tool: 'read_deployment_state',
        network: facts.network,
        chainId: facts.chainId,
        contractAddress: facts.contractAddress,
        blockNumber: facts.blockNumber,
        requestedBlock: blockNumber,
        suggestedProjectName: suggestedProjectName(facts.tokenName, facts.tokenSymbol),
        facts: {
          owner: facts.owner,
          pendingOwner: facts.pendingOwner,
          isSafe: facts.isSafe,
          safeThreshold: facts.safeThreshold,
          safeOwners: facts.safeOwners,
          isProxy: facts.isProxy,
          proxyKind: facts.proxyKind,
          implementation: facts.implementation,
          implementationCodeHash: facts.implementationCodeHash,
          upgradeAuthority: facts.upgradeAuthority,
          upgradeAuthorityIsSafe: facts.upgradeAuthorityIsSafe,
          timelockMinDelaySec: facts.timelockMinDelaySec,
          initializerSealed: facts.initializerSealed,
          totalSupply: facts.totalSupply,
          tokenName: facts.tokenName,
          tokenSymbol: facts.tokenSymbol,
          minterHolders: facts.minterHolders,
          feeRecipient: facts.feeRecipient,
          treasury: facts.treasury,
          oracle: facts.oracle,
          oracleUpdatedAt: facts.oracleUpdatedAt,
          router: facts.router,
          factory: facts.factory,
          pool: facts.pool,
          feeBps: facts.feeBps,
          deployer: facts.deployer,
          deployTxHash: facts.deployTxHash,
          codeHash: facts.codeHash,
          hasCode: facts.hasCode,
          verification: facts.verification.status,
          addressSanityFlags: facts.addressSanityFlags,
          readErrors: facts.readErrors.slice(0, 12),
        },
        note: 'Facts only — no verdict. Use create_policy_draft then founder Approve, then verify.',
        disclaimer: DISCLAIMER,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: /invalid|ahead of chain/i.test(msg) ? 400 : 502,
      body: { ok: false, error: 'read_failed', message: msg },
    };
  }
}

export async function runAgentCreateDraft(input: {
  packId: string;
  network?: string;
  contractAddress?: string;
  projectName?: string;
  /** Merge live facts into draft fields (still draft only). */
  fillFromLive?: boolean;
  overrides?: Partial<ManifestFields>;
  blockNumber?: number | string;
  /** Reuse a preloaded facts snapshot (avoids a second RPC round-trip). */
  facts?: ObservedFacts;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  let network: NetworkId;
  try {
    network = parseAgentNetwork(input.network);
  } catch (error) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'invalid_network',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const addr = input.contractAddress ? normalizeAddress(input.contractAddress) : null;
  if (input.contractAddress && !addr) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'invalid_address',
        message: 'contractAddress must be a valid 0x EVM address when provided.',
      },
    };
  }

  const seeded = seedDraftFromPack({
    packId: input.packId,
    network,
    contractAddress: addr ?? '',
    projectName: input.projectName ?? '',
    overrides: input.overrides,
  });

  if (!seeded.ok) {
    return {
      status: 400,
      body: { ok: false, error: seeded.error, message: seeded.message },
    };
  }

  let draft = seeded.draft;
  let sourceBlock: number | null = null;
  let filledFromLive = false;

  if (input.fillFromLive) {
    if (!addr) {
      return {
        status: 400,
        body: {
          ok: false,
          error: 'contract_required',
          message: 'fillFromLive requires contractAddress',
        },
      };
    }
    let blockNumber: number | undefined;
    if (input.blockNumber !== undefined && input.blockNumber !== '') {
      const n = Number(input.blockNumber);
      if (!Number.isInteger(n) || n < 0) {
        return {
          status: 400,
          body: { ok: false, error: 'invalid_block', message: 'blockNumber must be a non-negative integer' },
        };
      }
      blockNumber = n;
    }
    try {
      const facts =
        input.facts ??
        (await readFacts({ network, contractAddress: addr, blockNumber }));
      sourceBlock = facts.blockNumber;
      const { fields } = draftFieldsFromFacts(facts, draft);
      draft = fields;
      // Explicit overrides ALWAYS win over live import (approved-policy integrity)
      if (input.overrides) {
        for (const [k, v] of Object.entries(input.overrides)) {
          if (v === undefined) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (draft as any)[k] = v;
        }
      }
      if (input.projectName?.trim()) {
        draft.projectName = input.projectName.trim();
      }
      filledFromLive = true;
      if (!draft.projectName) {
        draft.projectName =
          suggestedProjectName(facts.tokenName, facts.tokenSymbol) ?? draft.projectName;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 502,
        body: { ok: false, error: 'live_fill_failed', message: msg },
      };
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      service: 'shomer',
      tool: 'create_policy_draft',
      status: 'draft_only',
      packId: seeded.pack.id,
      packTitle: seeded.pack.title,
      draft,
      packFields: seeded.pack.fields,
      filledFromLive,
      sourceBlock,
      approved: null,
      note: seeded.note,
      nextSteps: [
        'Founder reviews draft in Shomer UI (or offline)',
        'Founder Approves immutable vN',
        'Call POST /api/agent/verify with the approved policy fields',
      ],
      disclaimer: DISCLAIMER,
    },
  };
}

export function packsCatalogSlice() {
  return {
    packs: listPolicyPacks().map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      fields: p.fields,
    })),
    tools: [
      {
        name: 'list_policy_packs',
        method: 'GET',
        path: '/api/agent/packs',
      },
      {
        name: 'read_deployment_state',
        method: 'POST',
        path: '/api/agent/read',
        body: { network: 'mainnet|testnet', contractAddress: '0x…', blockNumber: 'optional' },
      },
      {
        name: 'create_policy_draft',
        method: 'POST',
        path: '/api/agent/draft',
        body: {
          packId: 'simple_ownable|safe_governed|uups_proxy|transparent_proxy|erc20_launch',
          contractAddress: '0x…',
          fillFromLive: true,
          overrides: 'optional partial fields',
        },
      },
      {
        name: 'verify_deployment',
        method: 'POST',
        path: '/api/agent/verify',
        tier: 'free',
      },
      {
        name: 'ship_gate',
        method: 'POST',
        path: '/api/agent/ship-gate',
        tier: 'free',
        description:
          'Composite free tool: optional pack draft + verify. Returns shipGate.allowed. Not paid Deep Verification.',
      },
      {
        name: 'verify_deployment_paid',
        method: 'POST',
        path: '/api/agent/verify/paid',
        tier: 'paid',
        description:
          'Deep Verification: privilegeMap + reviewedArtifact + auditorBrief via x402.',
      },
    ],
    freeVsPaid: {
      free: 'packs, read, draft, verify, ship-gate — policy vs live + evidence',
      paid: 'verify/paid — Deep Verification bundle (privilege map, artifact compare, auditor brief)',
    },
  };
}
