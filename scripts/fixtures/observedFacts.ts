import type { Address, Hex } from 'viem';
import type { ObservedFacts } from '../../src/lib/policy/types';

export const FIXTURE_CONTRACT =
  '0x1111111111111111111111111111111111111111' as Address;
export const FIXTURE_OWNER =
  '0x2222222222222222222222222222222222222222' as Address;

export function makeObservedFacts(
  overrides: Partial<ObservedFacts> = {},
): ObservedFacts {
  return {
    network: 'mainnet',
    chainId: 196,
    blockNumber: 12_345,
    timestamp: 1_700_000_000,
    contractAddress: FIXTURE_CONTRACT,
    codeHash: (`0x${'ab'.repeat(32)}`) as Hex,
    hasCode: true,
    deployer: null,
    deployTxHash: null,
    deployBlock: null,
    owner: FIXTURE_OWNER,
    ownerReadMethod: 'owner()',
    isOwnerContract: false,
    isSafe: false,
    safeThreshold: null,
    safeOwners: null,
    safeEvidence: { source: 'fixture Safe probe', block: 12_345 },
    isProxy: false,
    implementation: null,
    implementationCodeHash: null,
    proxyAdmin: null,
    upgradeAuthority: null,
    upgradeEvidence: { source: 'fixture EIP-1967 probe', block: 12_345 },
    timelockAddress: null,
    timelockMinDelaySec: null,
    timelockEvidence: { source: 'fixture timelock probe', block: 12_345 },
    initializerSealed: null,
    initializedVersion: null,
    initializerEvidence: null,
    totalSupply: null,
    tokenName: 'Fixture Token',
    tokenSymbol: 'FIX',
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
      source: 'fixture',
      evidence: { source: 'fixture verification', block: 12_345 },
    },
    rawCalls: [],
    readErrors: [],
    ...overrides,
  };
}
