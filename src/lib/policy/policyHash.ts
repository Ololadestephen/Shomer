import { keccak256, stringToHex, type Hex } from 'viem';
import type { ManifestFields } from './types';

/**
 * Deterministic commitment of an approved/draft policy snapshot for agent handoff.
 * Hash only — not a security proof of onchain state.
 */
export function policyHash(fields: ManifestFields): Hex {
  // Stable key order
  const keys = Object.keys(fields).sort() as (keyof ManifestFields)[];
  const payload: Record<string, unknown> = {};
  for (const k of keys) {
    payload[k] = fields[k];
  }
  return keccak256(stringToHex(JSON.stringify(payload)));
}
