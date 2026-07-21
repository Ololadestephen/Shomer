import type { ManifestFields } from './types';

/**
 * Named policy presets for agents (and optional UI later).
 * Explicit `policy` fields always win over preset defaults.
 */
export const POLICY_PRESETS: Record<string, Partial<ManifestFields>> = {
  /** Non-upgradeable deployment — no proxy expected. */
  non_upgradeable: {
    upgradeable: false,
  },
  /** Ownable-style, non-upgradeable. Declare owner separately. */
  ownable: {
    upgradeable: false,
  },
  /** Proxy expected; upgrade authority / Safe should be declared. */
  safe_owned_proxy: {
    upgradeable: true,
    minMultisigThreshold: 2,
  },
  /** Strict: non-upgradeable + minting not allowed after launch. */
  immutable_token: {
    upgradeable: false,
    mintingAllowedAfterLaunch: false,
  },
};

export type PolicyPresetId = keyof typeof POLICY_PRESETS;

export function resolvePolicyPreset(
  preset: string | undefined | null,
): Partial<ManifestFields> | null {
  if (!preset) return null;
  const key = preset.trim().toLowerCase().replace(/-/g, '_');
  return POLICY_PRESETS[key] ?? null;
}

export function listPolicyPresets(): string[] {
  return Object.keys(POLICY_PRESETS);
}
