import { defineChain } from 'viem';

/** BOT Chain Mainnet — chain id 677 */
export const botChainMainnet = defineChain({
  id: 677,
  name: 'BOT Chain Mainnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.botchain.ai', 'https://rpc.bohr.life'],
    },
  },
  blockExplorers: {
    default: {
      name: 'BOTScan',
      url: 'https://scan.botchain.ai',
    },
  },
});

/** BOT Chain Testnet — chain id 968 */
export const botChainTestnet = defineChain({
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.bohr.life'],
    },
  },
  blockExplorers: {
    default: {
      name: 'BOTScan Testnet',
      url: 'https://scan.bohr.life',
    },
  },
});

export type BotChainNetwork = 'botchain-mainnet' | 'botchain-testnet' | 'botchain';

export function getBotChain(network: BotChainNetwork) {
  return network === 'botchain-testnet' ? botChainTestnet : botChainMainnet;
}
