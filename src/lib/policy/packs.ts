import type { ManifestFieldKey, ManifestFields, NetworkId } from './types';
import { emptyManifest } from './types';
import { resolvePolicyPreset } from './presets';

/**
 * Policy packs: founder/agent templates that only expose fields Shomer can verify.
 * Selecting a pack seeds a DRAFT only — never an approved policy.
 */

export type PolicyPackId =
  | 'simple_ownable'
  | 'safe_governed'
  | 'uups_proxy'
  | 'transparent_proxy'
  | 'erc20_launch';

export interface PolicyPack {
  id: PolicyPackId;
  title: string;
  description: string;
  /** Fields the pack cares about (subset of verifiable surface). */
  fields: ManifestFieldKey[];
  /** Defaults applied into draft (never approved). */
  defaults: Partial<ManifestFields>;
  /** Maps to legacy policyPreset id when useful. */
  legacyPreset?: string;
}

/** Keys the engine actually exercises (keep packs inside this set). */
export const VERIFIABLE_FIELD_KEYS: ManifestFieldKey[] = [
  'projectName',
  'network',
  'contractAddress',
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
  'mintingAllowedAfterLaunch',
  'oracle',
  'oraclePair',
  'maxOracleStalenessSec',
  'approvedRouters',
  'approvedFactories',
  'approvedPools',
  'maxFeeBps',
  'maxSlippageBps',
];

export const POLICY_PACKS: PolicyPack[] = [
  {
    id: 'simple_ownable',
    title: 'Simple Ownable',
    description:
      'Non-upgradeable Ownable-style contract. Verify owner match, no proxy, address sanity.',
    fields: [
      'network',
      'contractAddress',
      'projectName',
      'owner',
      'expectedDeployer',
      'upgradeable',
    ],
    defaults: { upgradeable: false },
    legacyPreset: 'ownable',
  },
  {
    id: 'safe_governed',
    title: 'Safe-governed contract',
    description:
      'Ownership via Gnosis Safe / multisig. Threshold and Safe address are first-class.',
    fields: [
      'network',
      'contractAddress',
      'projectName',
      'owner',
      'expectedSafe',
      'minMultisigThreshold',
      'upgradeable',
      'expectedProxyAdminOrUpgradeAuthority',
      'timelockRequired',
      'minTimelockDelaySec',
    ],
    defaults: {
      upgradeable: false,
      minMultisigThreshold: 2,
    },
    legacyPreset: 'safe_owned_proxy',
  },
  {
    id: 'uups_proxy',
    title: 'UUPS proxy',
    description:
      'Upgradeable UUPS-style proxy. Implementation address/hash and upgrade authority matter.',
    fields: [
      'network',
      'contractAddress',
      'projectName',
      'owner',
      'upgradeable',
      'expectedProxyAdminOrUpgradeAuthority',
      'expectedImplementation',
      'expectedImplementationCodeHash',
      'timelockRequired',
      'minTimelockDelaySec',
    ],
    defaults: { upgradeable: true },
  },
  {
    id: 'transparent_proxy',
    title: 'Transparent proxy',
    description:
      'Transparent proxy with distinct proxy admin. Admin, implementation, and code hash.',
    fields: [
      'network',
      'contractAddress',
      'projectName',
      'owner',
      'upgradeable',
      'expectedProxyAdminOrUpgradeAuthority',
      'expectedImplementation',
      'expectedImplementationCodeHash',
      'timelockRequired',
      'minTimelockDelaySec',
    ],
    defaults: { upgradeable: true },
  },
  {
    id: 'erc20_launch',
    title: 'ERC-20 launch',
    description:
      'Token launch policy: control + supply/mint (+ optional fee). Only fields Shomer can probe.',
    fields: [
      'network',
      'contractAddress',
      'projectName',
      'owner',
      'expectedSafe',
      'minMultisigThreshold',
      'upgradeable',
      'expectedImplementation',
      'expectedImplementationCodeHash',
      'maxTokenSupply',
      'mintingAllowedAfterLaunch',
      'feeRecipient',
      'maxFeeBps',
      'treasury',
    ],
    defaults: {
      upgradeable: false,
      mintingAllowedAfterLaunch: false,
    },
    legacyPreset: 'immutable_token',
  },
];

export function listPolicyPacks(): PolicyPack[] {
  return POLICY_PACKS.map((p) => ({ ...p, fields: [...p.fields], defaults: { ...p.defaults } }));
}

export function getPolicyPack(id: string | undefined | null): PolicyPack | null {
  if (!id) return null;
  const key = id.trim().toLowerCase().replace(/-/g, '_');
  return POLICY_PACKS.find((p) => p.id === key) ?? null;
}

export interface SeedDraftFromPackInput {
  packId: string;
  network?: NetworkId;
  contractAddress?: string;
  projectName?: string;
  /** Optional partial overrides (still draft only). */
  overrides?: Partial<ManifestFields>;
}

/**
 * Seed a draft from a pack. NEVER returns an approved snapshot.
 * Only pack fields + identity keys are set; other keys stay empty/out of scope.
 */
export function seedDraftFromPack(input: SeedDraftFromPackInput): {
  ok: true;
  pack: PolicyPack;
  draft: ManifestFields;
  status: 'draft_only';
  note: string;
} | {
  ok: false;
  error: string;
  message: string;
} {
  const pack = getPolicyPack(input.packId);
  if (!pack) {
    return {
      ok: false,
      error: 'unknown_pack',
      message: `Unknown pack. Use one of: ${POLICY_PACKS.map((p) => p.id).join(', ')}`,
    };
  }

  const allowed = new Set<ManifestFieldKey>([
    ...pack.fields,
    'projectName',
    'network',
    'contractAddress',
  ]);

  const draft = emptyManifest({
    network: input.network ?? 'mainnet',
    contractAddress: input.contractAddress ?? '',
    projectName: input.projectName ?? '',
  });

  for (const [k, v] of Object.entries(pack.defaults) as [ManifestFieldKey, unknown][]) {
    if (!allowed.has(k)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (draft as any)[k] = v;
  }

  if (input.overrides) {
    for (const [k, v] of Object.entries(input.overrides) as [ManifestFieldKey, unknown][]) {
      if (!allowed.has(k)) continue;
      if (v === undefined) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (draft as any)[k] = v;
    }
  }

  // Identity always applied
  if (input.network) draft.network = input.network;
  if (input.contractAddress) draft.contractAddress = input.contractAddress;
  if (input.projectName) draft.projectName = input.projectName;

  return {
    ok: true,
    pack,
    draft,
    status: 'draft_only',
    note: 'Draft only — not approved. Founder must Approve vN before Verify. Never Policy Matched from pack selection.',
  };
}

/** Keep legacy presets working via packs when possible. */
export function packIdFromLegacyPreset(preset: string | undefined | null): PolicyPackId | null {
  if (!preset) return null;
  const p = resolvePolicyPreset(preset);
  if (!p) return null;
  const key = preset.trim().toLowerCase().replace(/-/g, '_');
  const hit = POLICY_PACKS.find((x) => x.legacyPreset === key);
  return hit?.id ?? null;
}

// Re-export presets list for catalog continuity
export { POLICY_PRESETS, listPolicyPresets } from './presets';
