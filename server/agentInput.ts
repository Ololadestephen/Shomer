import type { NetworkId } from '../src/lib/policy/types';

/** Supports X Layer networks and BOT Chain networks. */
export function parseAgentNetwork(raw: unknown): NetworkId {
  if (raw === undefined || raw === null || raw === '') return 'mainnet';
  const str = String(raw).trim().toLowerCase();

  switch (str) {
    case 'mainnet':
    case '196':
    case 'xlayer':
    case 'xlayer-mainnet':
      return 'mainnet';
    case 'testnet':
    case '1952':
    case '195':
    case 'xlayer-testnet':
      return 'testnet';
    case 'botchain':
    case 'botchain-mainnet':
    case '677':
      return 'botchain-mainnet';
    case 'botchain-testnet':
    case '968':
      return 'botchain-testnet';
    default:
      throw new Error(
        'network must be "mainnet", "testnet", "botchain-mainnet", or "botchain-testnet"',
      );
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
