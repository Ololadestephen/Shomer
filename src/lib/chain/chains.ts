import type { Chain } from 'viem';
import { xLayerMainnet, xLayerTestnet } from './xlayer';
import { botChainMainnet, botChainTestnet } from './botchain';

export { xLayerMainnet, xLayerTestnet } from './xlayer';
export { botChainMainnet, botChainTestnet } from './botchain';

export type CanonicalChainKey =
  | 'xlayer-mainnet'
  | 'xlayer-testnet'
  | 'botchain-mainnet'
  | 'botchain-testnet';

export type SupportedNetworkId =
  | 'mainnet'          // Legacy alias for X Layer Mainnet
  | 'testnet'          // Legacy alias for X Layer Testnet
  | 'xlayer'
  | 'xlayer-mainnet'
  | 'xlayer-testnet'
  | 'botchain'
  | 'botchain-mainnet'
  | 'botchain-testnet';

export const CHAIN_BY_ID: Record<number, Chain> = {
  196: xLayerMainnet,
  1952: xLayerTestnet,
  677: botChainMainnet,
  968: botChainTestnet,
};

/**
 * Registry addresses per chain.
 * Can be overridden via local environment or dynamically configured after deployment.
 */
export const SHOMER_REGISTRY_ADDRESSES: Record<number, `0x${string}`> = {
  // BOT Chain Mainnet placeholder / configured address
  677: '0xc427474201895710c653105067c543f184c99fa3',
  // BOT Chain Testnet verified contract
  968: '0x3C250cBf439431D7dd8525Ca9800c577a9533e3C',
  // X Layer Mainnet
  196: '0x5839244eab49314bccc0fa76e3a081cb1a461111',
  // X Layer Testnet
  1952: '0x5839244eab49314bccc0fa76e3a081cb1a461111',
};

export function isBotChain(chainId: number): boolean {
  return chainId === 677 || chainId === 968;
}

export function isXLayer(chainId: number): boolean {
  return chainId === 196 || chainId === 1952 || chainId === 195;
}

/**
 * Deterministically resolves a network name or chain ID into a viem Chain.
 * Preserves historical X Layer semantics for legacy 'mainnet' and 'testnet'.
 */
export function resolveChain(networkOrChainId: string | number | undefined | null): Chain {
  if (typeof networkOrChainId === 'number') {
    if (networkOrChainId === 195) return xLayerTestnet; // Historical testnet ID
    const chain = CHAIN_BY_ID[networkOrChainId];
    if (chain) return chain;
    throw new Error(`Unsupported chain ID: ${networkOrChainId}. Supported chains: 196, 1952, 677, 968.`);
  }

  const normalized = (networkOrChainId || 'mainnet').toString().trim().toLowerCase();

  switch (normalized) {
    case '196':
    case 'xlayer':
    case 'xlayer-mainnet':
    case 'mainnet':
      return xLayerMainnet;

    case '1952':
    case '195':
    case 'xlayer-testnet':
    case 'testnet':
      return xLayerTestnet;

    case '677':
    case 'botchain':
    case 'botchain-mainnet':
      return botChainMainnet;

    case '968':
    case 'botchain-testnet':
      return botChainTestnet;

    default:
      throw new Error(
        `Unsupported network: "${networkOrChainId}". Expected "mainnet" (X Layer), "testnet" (X Layer), "botchain-mainnet", or "botchain-testnet".`,
      );
  }
}

export function canonicalChainKey(chainOrId: Chain | number | string): CanonicalChainKey {
  const chain = typeof chainOrId === 'object' ? chainOrId : resolveChain(chainOrId);
  switch (chain.id) {
    case 677:
      return 'botchain-mainnet';
    case 968:
      return 'botchain-testnet';
    case 1952:
    case 195:
      return 'xlayer-testnet';
    case 196:
    default:
      return 'xlayer-mainnet';
  }
}

export function getExplorerAddressUrl(chainOrId: Chain | number | string, address: string): string {
  const chain = typeof chainOrId === 'object' ? chainOrId : resolveChain(chainOrId);
  const baseUrl = chain.blockExplorers?.default?.url || 'https://scan.botchain.ai';
  const cleanBase = baseUrl.replace(/\/$/, '');
  return `${cleanBase}/address/${address}`;
}

export function getExplorerTxUrl(chainOrId: Chain | number | string, txHash: string): string {
  const chain = typeof chainOrId === 'object' ? chainOrId : resolveChain(chainOrId);
  const baseUrl = chain.blockExplorers?.default?.url || 'https://scan.botchain.ai';
  const cleanBase = baseUrl.replace(/\/$/, '');
  return `${cleanBase}/tx/${txHash}`;
}
