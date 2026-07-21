import { readFacts } from '../src/lib/adapters/xlayer';
import { buildScanRun } from '../src/lib/policy/engine';
import { emptyManifest } from '../src/lib/policy/types';

const addr = '0x779ded0c9e1022225f8e0630b35a9b54be713736';
const facts = await readFacts({ network: 'mainnet', contractAddress: addr });

const wrong = emptyManifest({
  projectName: 'Owner mismatch test',
  network: 'mainnet',
  contractAddress: addr,
  owner: '0x5aFe00000000000000000000000000000000d021',
  expectedSafe: '0x5aFe00000000000000000000000000000000d021',
  upgradeable: true,
  expectedProxyAdminOrUpgradeAuthority: '0x5aFe00000000000000000000000000000000d021',
  expectedImplementation: '0x0000000000000000000000000000000000000001',
});

const scan = buildScanRun(wrong, facts, new Date().toISOString(), 1);
console.log('actual owner', facts.owner);
console.log('actual impl', facts.implementation);
console.log('isSafe', facts.isSafe, facts.safeThreshold);
console.log('verdict', scan.verdict);
for (const r of scan.results.filter((x) => x.status === 'blocked' || x.status === 'review')) {
  console.log(r.status, r.checkKey, '|', r.expected, '→', r.actual);
}

const match = emptyManifest({
  projectName: 'Owner match test',
  network: 'mainnet',
  contractAddress: addr,
  owner: facts.owner ?? '',
  expectedSafe: facts.owner ?? '',
  minMultisigThreshold: 3,
  upgradeable: true,
  expectedProxyAdminOrUpgradeAuthority: facts.upgradeAuthority ?? facts.owner ?? '',
  expectedImplementation: facts.implementation ?? '',
});
const scan2 = buildScanRun(match, facts, new Date().toISOString(), 1);
console.log('\n--- aligned policy ---');
console.log('verdict', scan2.verdict);
console.log('coverage', scan2.coverage);
console.log(
  scan2.results
    .map((r) => `${r.status.padEnd(8)} ${(r.skipReason ?? '-').padEnd(16)} ${r.checkKey}`)
    .join('\n'),
);
