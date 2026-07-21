import { readFacts } from '../src/lib/adapters/xlayer';
import { buildScanRun } from '../src/lib/policy/engine';
import { emptyManifest } from '../src/lib/policy/types';

const addr =
  process.argv[2] ?? '0xcA11bde05977b3631167028862bE2a173976CA11';

const started = new Date().toISOString();
console.log('Reading', addr, 'on X Layer mainnet…');

const facts = await readFacts({ network: 'mainnet', contractAddress: addr });
console.log(
  JSON.stringify(
    {
      chainId: facts.chainId,
      block: facts.blockNumber,
      hasCode: facts.hasCode,
      codeHash: facts.codeHash,
      owner: facts.owner,
      isProxy: facts.isProxy,
      implementation: facts.implementation,
      verification: facts.verification.status,
      sanity: facts.addressSanityFlags,
      errors: facts.readErrors.slice(0, 8),
    },
    null,
    2,
  ),
);

const manifest = emptyManifest({
  projectName: 'Smoke test',
  network: 'mainnet',
  contractAddress: addr,
  upgradeable: false,
});
const scan = buildScanRun(manifest, facts, started, 1);
console.log('\nverdict:', scan.verdict);
console.log('coverage:', scan.coverage);
console.log(
  scan.results
    .map(
      (r) =>
        `${r.status.padEnd(8)} ${(r.skipReason ?? '').padEnd(16)} ${r.checkKey}: ${r.actual.slice(0, 90)}`,
    )
    .join('\n'),
);
