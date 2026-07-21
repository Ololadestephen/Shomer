/**
 * Flagship Software Utility case: wrong owner → Blocked on X Layer mainnet.
 * Run: npm run case:blocked
 */
import { runAgentVerify } from '../server/agentVerify';

const CONTRACT = '0xbff976f8874814e6f2ee98d559826812ff26597f';
const WRONG = '0x5aFe00000000000000000000000000000000d021';

const readish = await runAgentVerify(
  {
    network: 'mainnet',
    contractAddress: CONTRACT,
    policy: { upgradeable: false },
    projectName: 'Case study live owner',
    options: { undeclaredObserved: 'out_of_scope' },
  },
  'free',
);

const liveOwner = readish.body.facts?.owner;
console.log('Live owner (from verify facts):', liveOwner);
console.log('policyHash (empty-ish policy):', readish.body.policyHash);

const blocked = await runAgentVerify(
  {
    network: 'mainnet',
    contractAddress: CONTRACT,
    policy: { upgradeable: false, owner: WRONG },
    projectName: 'Case study WRONG owner',
  },
  'free',
);

console.log('\n=== WRONG OWNER POLICY ===');
console.log('verdict:', blocked.body.verdict);
console.log('policyHash:', blocked.body.policyHash);
const ownerCheck = blocked.body.results?.find((r) => r.checkKey === 'owner_matches');
console.log('owner_matches:', ownerCheck?.status, '|', ownerCheck?.expected, '→', ownerCheck?.actual);

if (liveOwner) {
  const ok = await runAgentVerify(
    {
      network: 'mainnet',
      contractAddress: CONTRACT,
      policy: { upgradeable: false, owner: liveOwner },
      projectName: 'Case study CORRECT owner',
    },
    'free',
  );
  console.log('\n=== CORRECT OWNER POLICY ===');
  console.log('verdict:', ok.body.verdict);
  const oc = ok.body.results?.find((r) => r.checkKey === 'owner_matches');
  console.log('owner_matches:', oc?.status);
}

console.log('\nFree ship-gate would set shipGate.allowed=false when verdict=blocked.');
console.log('Paid Deep Verification: POST /api/agent/verify/paid (x402) for privilegeMap + artifact + brief.');
