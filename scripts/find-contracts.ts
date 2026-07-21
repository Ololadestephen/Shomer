import { createPublicClient, http, fallback, encodeFunctionData, defineChain, getAddress } from 'viem';

const xLayer = defineChain({
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com'] } },
});

const client = createPublicClient({
  chain: xLayer,
  transport: fallback([
    http('https://rpc.xlayer.tech', { timeout: 15000 }),
    http('https://xlayerrpc.okx.com', { timeout: 15000 })
  ]),
});

const ownerSelector = encodeFunctionData({
  abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
  functionName: 'owner',
});

const EIP1967_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

async function hasOwner(addr: `0x${string}`, blockNumber: bigint) {
  try {
    const res = await client.call({ to: addr, data: ownerSelector, blockNumber });
    if (res.data && res.data.length >= 66) {
      const owner = '0x' + res.data.slice(-40);
      if (owner !== '0x0000000000000000000000000000000000000000') {
        return getAddress(owner);
      }
    }
  } catch {}
  return null;
}

async function isProxy(addr: `0x${string}`, blockNumber: bigint) {
  try {
    const val = await client.getStorageAt({ address: addr, slot: EIP1967_IMPL, blockNumber });
    if (val && val !== '0x' + '0'.repeat(64)) {
      const impl = '0x' + val.slice(-40);
      if (impl !== '0x' + '0'.repeat(40)) return getAddress(impl);
    }
  } catch {}
  return null;
}

async function main() {
  const block = await client.getBlockNumber();
  console.log('Current block:', block.toString());
  console.log('Scanning last ~30 blocks for contracts with owner()...\n');

  const ownable: any[] = [];
  const proxies: any[] = [];

  for (let i = 0; i < 30 && (ownable.length < 2 || proxies.length < 2); i++) {
    const bn = block - BigInt(i);
    const b = await client.getBlock({ blockNumber: bn, includeTransactions: true });
    for (const tx of b.transactions) {
      if (typeof tx === 'string' || !tx.to) continue;
      const to = tx.to as `0x${string}`;

      const owner = await hasOwner(to, bn);
      if (!owner) continue;

      const impl = await isProxy(to, bn);
      const entry = { contract: to, owner, block: Number(bn), impl };

      if (impl) {
        if (!proxies.find(p => p.contract === to)) {
          proxies.push(entry);
          console.log('PROXY+OWNABLE:', entry);
        }
      } else {
        if (!ownable.find(o => o.contract === to)) {
          ownable.push(entry);
          console.log('STANDARD OWNABLE:', entry);
        }
      }

      if (ownable.length >= 2 && proxies.length >= 2) break;
    }
  }

  console.log('\n=== FINAL CANDIDATES ===');
  console.log('Standard Ownable:', ownable);
  console.log('Proxy with owner:', proxies);

  // Also include known good non-standard
  console.log('\nNon-standard example (Multicall3): 0xcA11bde05977b3631167028862bE2a173976CA11');
}

main().catch(console.error);
