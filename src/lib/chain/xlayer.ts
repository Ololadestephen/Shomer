import { defineChain } from 'viem';

/** X Layer Mainnet — chain id 196 */
export const xLayerMainnet = defineChain({
  id: 196,
  name: 'X Layer Mainnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'OKX Explorer',
      url: 'https://www.okx.com/web3/explorer/xlayer',
    },
  },
});

/**
 * X Layer Testnet (current public docs: chain id 1952).
 * Older docs listed 195 — adapter still accepts either if RPC responds.
 */
export const xLayerTestnet = defineChain({
  id: 1952,
  name: 'X Layer Testnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://testrpc.xlayer.tech/terigon',
        'https://xlayertestrpc.okx.com/terigon',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'OKX Explorer (Testnet)',
      url: 'https://www.okx.com/web3/explorer/xlayer-test',
    },
  },
});

export type XLayerNetwork = 'mainnet' | 'testnet';

export function getXLayerChain(network: XLayerNetwork) {
  return network === 'mainnet' ? xLayerMainnet : xLayerTestnet;
}

export const EIP1967 = {
  implementation:
    '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const,
  admin:
    '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103' as const,
  beacon:
    '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50' as const,
};

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;
