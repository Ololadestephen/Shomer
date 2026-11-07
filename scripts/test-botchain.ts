import { resolveChain, canonicalChainKey, isBotChain } from '../src/lib/chain/chains';
import { runAgentVerify } from '../server/agentVerify';
import { runAgentShipGate } from '../server/agentShipGate';
import { emptyManifest, type ObservedFacts } from '../src/lib/policy/types';
import { runPolicyChecks } from '../src/lib/policy/engine';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function runBotChainTests(): Promise<void> {
  console.log('Testing BOT Chain network resolution, policy evaluation, and agent API safety...');

  // 1. Chain resolution
  const mainnetChain = resolveChain('botchain-mainnet');
  assert(mainnetChain.id === 677, 'BOT Chain mainnet must have chain ID 677');
  assert(mainnetChain.nativeCurrency.symbol === 'BOT', 'Native currency must be BOT');
  assert(isBotChain(677), 'isBotChain must be true for 677');

  const testnetChain = resolveChain('botchain-testnet');
  assert(testnetChain.id === 968, 'BOT Chain testnet must have chain ID 968');
  assert(isBotChain(968), 'isBotChain must be true for 968');

  // Short aliases
  assert(resolveChain('botchain').id === 677, '"botchain" alias must resolve to 677');
  assert(resolveChain(677).id === 677, 'Numeric 677 must resolve to 677');
  assert(resolveChain(968).id === 968, 'Numeric 968 must resolve to 968');

  // Canonical chain keys
  assert(canonicalChainKey(677) === 'botchain-mainnet', 'Canonical key for 677 must be botchain-mainnet');
  assert(canonicalChainKey(968) === 'botchain-testnet', 'Canonical key for 968 must be botchain-testnet');
  assert(canonicalChainKey(196) === 'xlayer-mainnet', 'Canonical key for 196 must be xlayer-mainnet');
  console.log('ok: BOT Chain network definitions and chain resolution pass');

  // 2. Simulated BOT Chain facts & policy check
  const contractAddress = '0x1559C3a6B02E331307438D7839016EA5A827F467' as const;
  const ownerAddress = '0x466e3B26b771e89F4B3CDE91567117Fe68F25693' as const;

  const botFactsVerified: ObservedFacts = {
    network: 'botchain-mainnet',
    chainId: 677,
    blockNumber: 19263053,
    timestamp: 1730818800,
    contractAddress,
    codeHash: '0xdd02e913a2113e1f1ebe3fc360452b6947daac85d0f0543ad881a5bd7e55afab' as const,
    hasCode: true,
    deployer: null,
    deployTxHash: null,
    deployBlock: null,
    owner: ownerAddress,
    ownerReadMethod: 'owner()',
    isOwnerContract: false,
    isSafe: false,
    safeThreshold: null,
    safeOwners: null,
    safeEvidence: null,
    isProxy: false,
    implementation: null,
    implementationCodeHash: null,
    proxyAdmin: null,
    upgradeAuthority: null,
    upgradeEvidence: null,
    timelockAddress: null,
    timelockMinDelaySec: null,
    timelockEvidence: null,
    initializerSealed: null,
    initializedVersion: null,
    initializerEvidence: null,
    totalSupply: null,
    tokenName: null,
    tokenSymbol: null,
    feeRecipient: null,
    treasury: null,
    minterHolders: null,
    factory: null,
    pool: null,
    feeBps: null,
    slippageBps: null,
    oracle: null,
    oracleUpdatedAt: null,
    router: null,
    pendingOwner: null,
    proxyKind: null,
    upgradeAuthorityIsSafe: null,
    upgradeAuthoritySafeThreshold: null,
    roles: [],
    addressSanityFlags: [],
    verification: {
      status: 'verified',
      source: 'BOTScan / Sourcify',
      details: 'exact_match',
      evidence: { source: 'Sourcify API', raw: 'exact_match' },
    },
    rawCalls: [],
    readErrors: [],
  };

  const matchingPolicy = emptyManifest({
    projectName: 'CipherBallot Production',
    network: 'botchain-mainnet',
    contractAddress,
    owner: ownerAddress,
    upgradeable: false,
  });

  const check1 = runPolicyChecks(matchingPolicy, botFactsVerified, { undeclaredObserved: 'out_of_scope' });
  assert(check1.verdict === 'policy_matched', `Expected policy_matched for verified contract, got ${check1.verdict}`);
  console.log('ok: verified BOT Chain contract with matching policy produces policy_matched');

  // When source verification is unconfirmed/unknown, verdict stays review_required
  const botFactsUnknown: ObservedFacts = {
    ...botFactsVerified,
    verification: {
      status: 'unknown',
      details: 'Could not confirm verification status. Check BOTScan manually.',
      evidence: { source: 'Sourcify', note: 'Not found on Sourcify for chain 677' },
    },
  };
  const checkUnknown = runPolicyChecks(matchingPolicy, botFactsUnknown, { undeclaredObserved: 'out_of_scope' });
  assert(checkUnknown.verdict === 'review_required', `Unconfirmed verification must yield review_required, got ${checkUnknown.verdict}`);
  console.log('ok: unconfirmed verification on BOT Chain honestly remains review_required');

  // Mismatched owner on BOT Chain
  const wrongOwnerPolicy = emptyManifest({
    projectName: 'CipherBallot Production',
    network: 'botchain-mainnet',
    contractAddress,
    owner: '0x000000000000000000000000000000000000dEaD',
    upgradeable: false,
  });
  const check2 = runPolicyChecks(wrongOwnerPolicy, botFactsVerified, { undeclaredObserved: 'out_of_scope' });
  assert(check2.verdict === 'blocked', `Wrong owner must yield blocked, got ${check2.verdict}`);
  console.log('ok: wrong owner on BOT Chain yields blocked verdict');

  // 3. Agent verify endpoint with BOT Chain network
  const agentVerifyRes = await runAgentVerify(
    {
      network: 'botchain-mainnet',
      contractAddress,
      policy: {
        owner: ownerAddress,
        upgradeable: false,
      },
      projectName: 'BOT Chain Production Check',
      options: { undeclaredObserved: 'out_of_scope' },
    },
    'free',
    { facts: botFactsVerified },
  );

  assert(agentVerifyRes.status === 200, `Expected HTTP 200 from agent verify, got ${agentVerifyRes.status}`);
  assert(agentVerifyRes.body.ok === true, 'Response ok must be true');
  assert(agentVerifyRes.body.chainId === 677, `Response chainId must be 677, got ${agentVerifyRes.body.chainId}`);
  assert(agentVerifyRes.body.network === 'botchain-mainnet', 'Response network must be botchain-mainnet');
  assert(agentVerifyRes.body.verdict === 'policy_matched', 'Response verdict must match policy_matched');
  console.log('ok: runAgentVerify correctly processes BOT Chain network and echoes chainId 677');

  // 4. Ship gate endpoint with BOT Chain
  const shipGateRes = await runAgentShipGate(
    {
      network: 'botchain-mainnet',
      contractAddress,
      policy: {
        owner: ownerAddress,
        upgradeable: false,
      },
      approvedPolicy: true,
      options: { undeclaredObserved: 'out_of_scope' },
    },
    { readFacts: async () => botFactsVerified },
  );

  assert(shipGateRes.status === 200, `Ship gate expected 200, got ${shipGateRes.status}`);
  const shipGateData = (shipGateRes.body as any).shipGate as { allowed: boolean; verdict: string };
  assert(shipGateData.allowed === true, 'Ship gate allowed must be true for matched approved policy');
  assert(shipGateData.verdict === 'policy_matched', 'Ship gate verdict must be policy_matched');
  console.log('ok: runAgentShipGate correctly evaluates BOT Chain contract deployment');

  console.log('All BOT Chain integration tests passed.');
}

runBotChainTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
