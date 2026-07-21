import type { NetworkId } from '../src/lib/policy/types';

/** Only X Layer networks supported by the MVP are accepted. */
export function parseAgentNetwork(raw: unknown): NetworkId {
  if (raw === undefined || raw === null || raw === '') return 'mainnet';
  if (raw === 'mainnet' || raw === 'testnet') return raw;
  throw new Error('network must be "mainnet" or "testnet"');
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
