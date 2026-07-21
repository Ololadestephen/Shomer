import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  encodeFunctionData,
  decodeFunctionResult,
  getAddress,
  http,
  isAddress,
  keccak256,
  fallback,
} from 'viem';
import {
  accessControlAbi,
  chainlinkAggregatorAbi,
  commonGettersAbi,
  erc1967Abi,
  initializerAbi,
  ownable2StepAbi,
  ownableAbi,
  safeAbi,
  timelockAbi,
} from '../abis';
import {
  EIP1967,
  ZERO_ADDRESS,
  getXLayerChain,
  type XLayerNetwork,
} from '../chain/xlayer';
import type {
  EvidenceRecord,
  ObservedFacts,
  RoleObservation,
  VerificationStatus,
} from '../policy/types';
import {
  isZeroOrPlaceholder,
  normalizeAddress,
  slotToAddress,
} from '../utils/address';

export interface ReadFactsInput {
  network: XLayerNetwork;
  contractAddress: string;
  /**
   * Optional base for the creation-info proxy (default: same origin).
   * Browser uses `/api/oklink/creation-info` via Vite middleware.
   * Node scripts may set SHOMER_API_BASE or rely on process.env.OKLINK_API_KEY.
   */
  proxyBase?: string;
  /**
   * Pin all eth_* reads to this block (inclusive). Omit for latest.
   * Must be a positive integer ≤ current chain head.
   */
  blockNumber?: number | bigint | string;
}

export interface RelatedAddressInspection {
  address: Address;
  hasCode: boolean | null;
  codeHash: Hex | null;
  bytecodeSize: number | null;
  evidence: EvidenceRecord;
}

interface DeployerLookup {
  deployer: Address | null;
  txHash: Hex | null;
  deployBlock: number | null;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** Node env only — never use VITE_* keys. Safe when process is undefined (browser). */
function nodeEnv(name: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return p?.env?.[name]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function chainShortName(network: XLayerNetwork): string {
  return network === 'testnet' ? 'XLAYER_TESTNET' : 'XLAYER';
}

function parseDeployerPayload(
  data: Record<string, unknown>,
): { creator: string | null; txHash: string | null; deployBlock: number | null } {
  let nested: Record<string, unknown> | undefined;
  const d = data.data;
  if (Array.isArray(d) && d.length > 0 && d[0] && typeof d[0] === 'object') {
    nested = d[0] as Record<string, unknown>;
  } else if (d && typeof d === 'object') {
    nested = d as Record<string, unknown>;
  }

  const creator =
    (nested?.creator as string) ||
    (nested?.contractCreator as string) ||
    (nested?.deployer as string) ||
    (data.deployer as string) ||
    (data.contractCreator as string) ||
    (data.creator as string) ||
    null;

  const tx =
    (nested?.txHash as string) ||
    (nested?.creationTransactionHash as string) ||
    (nested?.txnHash as string) ||
    (data.txHash as string) ||
    null;

  const blockRaw =
    nested?.createContractBlock ||
    nested?.blockHeight ||
    nested?.blockNumber ||
    data.deployBlock ||
    data.blockHeight;
  const deployBlock =
    blockRaw !== undefined && blockRaw !== null && blockRaw !== ''
      ? Number(blockRaw)
      : null;

  return {
    creator: creator && typeof creator === 'string' ? creator : null,
    txHash: tx && typeof tx === 'string' ? tx : null,
    deployBlock:
      deployBlock !== null && Number.isFinite(deployBlock) ? deployBlock : null,
  };
}

function toDeployerResult(
  creator: string | null,
  txHash: string | null,
  deployBlock: number | null,
): DeployerLookup | null {
  if (!creator || !isAddress(creator, { strict: false })) return null;
  return {
    deployer: getAddress(creator),
    txHash: txHash && txHash.startsWith('0x') ? (txHash as Hex) : null,
    deployBlock,
  };
}

function clientFor(network: XLayerNetwork): PublicClient {
  const chain = getXLayerChain(network);
  const urls = chain.rpcUrls.default.http;
  return createPublicClient({
    chain,
    transport: fallback(urls.map((url) => http(url, { timeout: 20_000 }))),
  });
}

/**
 * Lightweight, block-pinned code classification for privilege-map nodes.
 * Deliberately bounded by the caller so paid verification cannot fan out into
 * an unbounded recursive scan.
 */
export async function inspectRelatedAddresses(input: {
  network: XLayerNetwork;
  addresses: string[];
  blockNumber: number;
}): Promise<RelatedAddressInspection[]> {
  const unique = new Map<string, Address>();
  for (const raw of input.addresses) {
    const address = normalizeAddress(raw);
    if (!address) continue;
    unique.set(address.toLowerCase(), address);
  }

  const client = clientFor(input.network);
  const blockNumber = BigInt(input.blockNumber);
  return Promise.all(
    [...unique.values()].map(async (address) => {
      try {
        const bytecode = await client.getBytecode({ address, blockNumber });
        const hasCode = Boolean(bytecode && bytecode !== '0x');
        const bytecodeSize = hasCode && bytecode ? (bytecode.length - 2) / 2 : 0;
        const codeHash = hasCode && bytecode ? keccak256(bytecode) : null;
        return {
          address,
          hasCode,
          codeHash,
          bytecodeSize,
          evidence: {
            source: 'eth_getCode (paid privilege-map probe)',
            block: input.blockNumber,
            raw: hasCode
              ? `bytecode length ${bytecodeSize} bytes; codehash ${codeHash}`
              : 'empty bytecode (EOA or undeployed address)',
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          address,
          hasCode: null,
          codeHash: null,
          bytecodeSize: null,
          evidence: {
            source: 'eth_getCode (paid privilege-map probe)',
            block: input.blockNumber,
            note: `Probe failed: ${message.split('\n')[0]}`,
          },
        };
      }
    }),
  );
}

async function safeCall<T>(
  label: string,
  fn: () => Promise<T>,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<T | null> {
  try {
    const result = await fn();
    rawCalls.push({
      source: label,
      raw: typeof result === 'object' ? JSON.stringify(result, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ) : String(result),
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    readErrors.push(`${label}: ${msg.split('\n')[0]}`);
    rawCalls.push({ source: label, note: 'call failed', raw: msg.split('\n')[0] });
    return null;
  }
}

async function readOwner(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<{ owner: Address | null; method: string | null }> {
  const result = await safeCall(
    'owner()',
    () =>
      client.readContract({
        address,
        abi: ownableAbi,
        functionName: 'owner',
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );
  if (result && isAddress(result)) {
    return { owner: getAddress(result), method: 'owner()' };
  }
  return { owner: null, method: null };
}

async function probeSafe(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<{
  isSafe: boolean | null;
  threshold: number | null;
  owners: Address[] | null;
  evidence: EvidenceRecord | null;
}> {
  const code = await client.getBytecode({ address, blockNumber });
  if (!code || code === '0x') {
    return {
      isSafe: false,
      threshold: null,
      owners: null,
      evidence: {
        source: 'getCode(owner)',
        raw: 'EOA or empty code',
        note: 'Owner has no bytecode — treated as EOA, not a Safe.',
      },
    };
  }

  const threshold = await safeCall(
    'getThreshold() on owner',
    () =>
      client.readContract({
        address,
        abi: safeAbi,
        functionName: 'getThreshold',
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );

  const owners = await safeCall(
    'getOwners() on owner',
    () =>
      client.readContract({
        address,
        abi: safeAbi,
        functionName: 'getOwners',
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );

  if (threshold !== null && owners !== null) {
    return {
      isSafe: true,
      threshold: Number(threshold),
      owners: owners.map((o) => getAddress(o)),
      evidence: {
        source: 'Gnosis Safe getThreshold() + getOwners()',
        raw: `threshold=${threshold.toString()}, owners=${owners.length}`,
      },
    };
  }

  return {
    isSafe: null,
    threshold: null,
    owners: null,
    evidence: {
      source: 'Safe interface probe',
      note: 'Owner is a contract but Safe getters failed — not confirmed as Safe.',
      raw: 'getThreshold/getOwners unavailable',
    },
  };
}

async function readProxySlots(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<{
  isProxy: boolean | null;
  implementation: Address | null;
  proxyAdmin: Address | null;
  implementationCodeHash: Hex | null;
  evidence: EvidenceRecord | null;
}> {
  const implSlot = await safeCall(
    `storage[${EIP1967.implementation}]`,
    () =>
      client.getStorageAt({
        address,
        slot: EIP1967.implementation,
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );
  const adminSlot = await safeCall(
    `storage[${EIP1967.admin}]`,
    () =>
      client.getStorageAt({
        address,
        slot: EIP1967.admin,
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );

  const implementation = slotToAddress(implSlot ?? undefined);
  const proxyAdmin = slotToAddress(adminSlot ?? undefined);

  let implementationCodeHash: Hex | null = null;
  if (implementation) {
    implementationCodeHash = await safeCall(
      `extcodehash(implementation ${implementation})`,
      () => client.getBytecode({ address: implementation, blockNumber }).then((b) => (b ? keccak256(b) : null)),
      rawCalls,
      readErrors,
    );
  }

  if (implementation) {
    return {
      isProxy: true,
      implementation,
      proxyAdmin,
      implementationCodeHash,
      evidence: {
        source: 'EIP-1967 implementation slot',
        slot: EIP1967.implementation,
        raw: `implementation=${implementation}${proxyAdmin ? `; admin=${proxyAdmin}` : ''}`,
      },
    };
  }

  // Transparent / custom implementation() getter
  try {
    const data = encodeFunctionData({
      abi: [{ type: 'function', name: 'implementation', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
      functionName: 'implementation',
    });
    const raw = await client.call({ to: address, data, blockNumber });
    if (raw.data && raw.data !== '0x') {
      const decoded = decodeFunctionResult({
        abi: [{ type: 'function', name: 'implementation', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
        functionName: 'implementation',
        data: raw.data,
      }) as Address;
      if (isAddress(decoded) && decoded !== ZERO_ADDRESS) {
        const impl = getAddress(decoded);
        rawCalls.push({ source: 'implementation()', raw: impl });
        const hash = await safeCall(
          `extcodehash(implementation ${impl})`,
          () => client.getBytecode({ address: impl, blockNumber }).then((b) => (b ? keccak256(b) : null)),
          rawCalls,
          readErrors,
        );
        return {
          isProxy: true,
          implementation: impl,
          proxyAdmin,
          implementationCodeHash: hash,
          evidence: { source: 'implementation()', raw: impl },
        };
      }
    }
  } catch {
    // not a proxy with that getter
  }

  return {
    isProxy: false,
    implementation: null,
    proxyAdmin: null,
    implementationCodeHash: null,
    evidence: {
      source: 'EIP-1967 + implementation()',
      note: 'No proxy implementation slot or getter found — treated as non-proxy unless policy says upgradeable.',
      raw: implSlot ?? 'empty',
    },
  };
}

async function readTimelock(
  client: PublicClient,
  candidates: (Address | null)[],
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<{
  address: Address | null;
  minDelay: number | null;
  evidence: EvidenceRecord | null;
}> {
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    const delay = await safeCall(
      `getMinDelay() @ ${c}`,
      () =>
        client.readContract({
          address: c,
          abi: timelockAbi,
          functionName: 'getMinDelay',
          blockNumber,
        }),
      rawCalls,
      readErrors,
    );
    if (delay !== null) {
      return {
        address: c,
        minDelay: Number(delay),
        evidence: {
          source: `getMinDelay() at ${c}`,
          raw: `${delay.toString()} seconds`,
        },
      };
    }
  }
  return {
    address: null,
    minDelay: null,
    evidence: {
      source: 'getMinDelay() probe',
      note: 'No TimelockController-compatible getMinDelay() on owner/admin/upgrade authority.',
      raw: 'not found',
    },
  };
}

async function readInitializer(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<{
  sealed: boolean | null;
  version: number | null;
  evidence: EvidenceRecord | null;
}> {
  // OZ Initializable stores version; common storage slot patterns vary.
  // We try the public initialized() if present; otherwise skip.
  const version = await safeCall(
    'initialized()',
    () =>
      client.readContract({
        address,
        abi: initializerAbi,
        functionName: 'initialized',
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );

  if (version !== null) {
    const v = Number(version);
    // OZ: 255 means disabled / sealed in some versions
    const sealed = v > 0;
    return {
      sealed,
      version: v,
      evidence: {
        source: 'initialized()',
        raw: `version=${v}${v === 255 ? ' (disabled/sealed sentinel)' : ''}`,
      },
    };
  }

  // Fallback: ERC-7201 Initializable storage location (OZ 5)
  // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
  const oz5Slot =
    '0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00' as Hex;
  const slotVal = await safeCall(
    `storage[OZ Initializable]`,
    () => client.getStorageAt({ address, slot: oz5Slot, blockNumber }),
    rawCalls,
    readErrors,
  );
  if (slotVal && slotVal !== '0x' + '0'.repeat(64)) {
    const asNum = Number(BigInt(slotVal));
    return {
      sealed: asNum > 0,
      version: asNum & 0xff,
      evidence: {
        source: 'OZ Initializable storage slot',
        slot: oz5Slot,
        raw: slotVal,
      },
    };
  }

  return {
    sealed: null,
    version: null,
    evidence: {
      source: 'initializer probe',
      note: 'Could not read Initializable state — pattern unknown or not upgradeable-initialized.',
      raw: 'unavailable',
    },
  };
}

async function readOptionalAddressGetter(
  client: PublicClient,
  address: Address,
  functionName:
    | 'feeRecipient'
    | 'treasury'
    | 'oracle'
    | 'router'
    | 'factory'
    | 'pool'
    | 'minter',
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<Address | null> {
  const result = await safeCall(
    `${functionName}()`,
    () =>
      client.readContract({
        address,
        abi: commonGettersAbi,
        functionName,
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );
  if (result && isAddress(result)) return getAddress(result);
  return null;
}

async function readOptionalUintGetter(
  client: PublicClient,
  address: Address,
  functionName: 'fee' | 'feeBps' | 'maxSlippageBps',
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<number | null> {
  const result = await safeCall(
    `${functionName}()`,
    () =>
      client.readContract({
        address,
        abi: commonGettersAbi,
        functionName,
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );
  if (result === null || result === undefined) return null;
  try {
    const n = Number(result);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}


async function readOptionalStringGetter(
  client: PublicClient,
  address: Address,
  functionName: 'name' | 'symbol',
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<string | null> {
  const result = await safeCall(
    `${functionName}()`,
    () =>
      client.readContract({
        address,
        abi: commonGettersAbi,
        functionName,
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );
  if (typeof result !== 'string') return null;
  const s = result.replace(/\0/g, '').trim();
  if (!s || s.length > 120) return null;
  return s;
}

async function readPendingOwner(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<Address | null> {
  const result = await safeCall(
    'pendingOwner()',
    () =>
      client.readContract({
        address,
        abi: ownable2StepAbi,
        functionName: 'pendingOwner',
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );
  if (result && isAddress(result) && result !== ZERO_ADDRESS) {
    return getAddress(result);
  }
  return null;
}

async function detectProxyKind(
  client: PublicClient,
  address: Address,
  isProxy: boolean | null,
  proxyAdmin: Address | null,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
): Promise<'transparent' | 'uups' | 'unknown' | null> {
  if (!isProxy) return null;
  if (proxyAdmin) return 'transparent';
  try {
    const uuid = await client.readContract({
      address,
      abi: erc1967Abi,
      functionName: 'proxiableUUID',
      blockNumber,
    });
    rawCalls.push({
      source: 'proxiableUUID()',
      block: Number(blockNumber),
      raw: String(uuid),
      note: 'UUPS-style proxiableUUID present',
    });
    return 'uups';
  } catch {
    return 'unknown';
  }
}

async function readOracleUpdatedAt(
  client: PublicClient,
  oracle: Address | null,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
): Promise<number | null> {
  if (!oracle) return null;
  const result = await safeCall(
    'oracle.latestRoundData()',
    () =>
      client.readContract({
        address: oracle,
        abi: chainlinkAggregatorAbi,
        functionName: 'latestRoundData',
        blockNumber,
      }),
    rawCalls,
    readErrors,
  );
  if (!result || !Array.isArray(result)) return null;
  // [roundId, answer, startedAt, updatedAt, answeredInRound]
  const updatedAt = result[3];
  if (updatedAt === undefined || updatedAt === null) return null;
  try {
    return Number(updatedAt);
  } catch {
    return null;
  }
}


const COMMON_ROLE_NAMES = [
  'DEFAULT_ADMIN_ROLE',
  'PAUSER_ROLE',
  'MINTER_ROLE',
  'UPGRADER_ROLE',
  'OPERATOR_ROLE',
  'MANAGER_ROLE',
];

function computeRole(roleName: string): Hex {
  if (roleName === 'DEFAULT_ADMIN_ROLE') {
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }
  // keccak256("ROLE_NAME")
  return keccak256(new TextEncoder().encode(roleName));
}

async function enumerateAccessControlRoles(
  client: PublicClient,
  contract: Address,
  blockNumber: bigint,
  rawCalls: EvidenceRecord[],
  _readErrors: string[],
  knownAddresses: Address[],
): Promise<RoleObservation[]> {
  const observations: RoleObservation[] = [];

  // Try to read DEFAULT_ADMIN_ROLE constant if present
  let defaultAdmin: Hex | null = null;
  try {
    const admin = await client.readContract({
      address: contract,
      abi: accessControlAbi,
      functionName: 'DEFAULT_ADMIN_ROLE',
      blockNumber,
    });
    defaultAdmin = admin as Hex;
    rawCalls.push({ source: 'DEFAULT_ADMIN_ROLE()', raw: defaultAdmin });
  } catch {
    defaultAdmin = '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  const rolesToCheck = [
    { name: 'DEFAULT_ADMIN_ROLE', bytes: defaultAdmin! },
    ...COMMON_ROLE_NAMES.filter(n => n !== 'DEFAULT_ADMIN_ROLE').map(name => ({
      name,
      bytes: computeRole(name),
    })),
  ];

  for (const { name, bytes } of rolesToCheck) {
    const holderSet = new Set<string>();
    let enumerated = false;

    // Prefer Enumerable role members when available (cap 10)
    try {
      const countRaw = await client.readContract({
        address: contract,
        abi: accessControlAbi,
        functionName: 'getRoleMemberCount',
        args: [bytes],
        blockNumber,
      });
      const count = Number(countRaw);
      if (Number.isFinite(count) && count > 0) {
        enumerated = true;
        const lim = Math.min(count, 10);
        for (let i = 0; i < lim; i++) {
          try {
            const member = await client.readContract({
              address: contract,
              abi: accessControlAbi,
              functionName: 'getRoleMember',
              args: [bytes, BigInt(i)],
              blockNumber,
            });
            if (member && isAddress(member)) holderSet.add(getAddress(member));
          } catch {
            break;
          }
        }
        rawCalls.push({
          source: `getRoleMemberCount(${name})`,
          block: Number(blockNumber),
          raw: `count=${count}, listed=${holderSet.size}`,
        });
      }
    } catch {
      // not enumerable
    }

    for (const acc of knownAddresses) {
      if (!acc) continue;
      try {
        const has = await client.readContract({
          address: contract,
          abi: accessControlAbi,
          functionName: 'hasRole',
          args: [bytes, acc],
          blockNumber,
        });
        if (has) holderSet.add(getAddress(acc));
      } catch {
        // contract may not implement AccessControl
      }
    }

    const holders = [...holderSet] as Address[];
    if (holders.length > 0) {
      observations.push({
        role: name,
        holders,
        evidence: {
          source: enumerated ? `getRoleMember + hasRole(${name})` : `hasRole(${name})`,
          block: Number(blockNumber),
          raw: holders.join(','),
          note: enumerated
            ? 'Enumerated via getRoleMemberCount/getRoleMember (capped at 10) plus known-address hasRole probe.'
            : 'Limited probe: common roles checked against known privileged addresses and/or partial hasRole.',
        },
      });
    }
  }

  if (observations.length > 0) {
    rawCalls.push({
      source: 'AccessControl roles',
      raw: observations.map(o => `${o.role}: ${o.holders.join(',')}`).join(' | '),
      note: 'Uses getRoleMember enumeration when available (cap 10); otherwise known-address hasRole probe only.',
    });
  }

  return observations;
}

/**
 * Deployer / creation-tx lookup.
 * Order: same-origin proxy (authenticated, key server-only) →
 *        Node process.env.OKLINK_API_KEY (scripts only) →
 *        public OKLink (best-effort) →
 *        null (never fabricated).
 */
async function fetchDeployer(
  network: XLayerNetwork,
  address: Address,
  rawCalls: EvidenceRecord[],
  readErrors: string[],
  proxyBase?: string,
): Promise<DeployerLookup> {
  // 1) Same-origin / configured proxy (browser + vite preview)
  const base =
    proxyBase?.replace(/\/$/, '') ||
    (isBrowser() ? '' : nodeEnv('SHOMER_API_BASE')?.replace(/\/$/, '') || '');
  const proxyUrl = `${base}/api/oklink/creation-info?network=${network}&contractAddress=${address}`;

  try {
    const res = await fetch(proxyUrl, {
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }

    rawCalls.push({
      source: 'Shomer OKLink proxy /api/oklink/creation-info',
      note: `HTTP ${res.status}`,
      raw: text.slice(0, 500),
    });

    if (body.ok === true && typeof body.deployer === 'string') {
      const hit = toDeployerResult(
        body.deployer,
        (body.txHash as string) ?? null,
        body.deployBlock !== undefined && body.deployBlock !== null
          ? Number(body.deployBlock)
          : null,
      );
      if (hit) {
        rawCalls.push({
          source: String(body.source ?? 'OKLink via proxy'),
          raw: String(body.raw ?? '').slice(0, 400),
          note: 'Authenticated path; API key stayed on the server.',
        });
        return hit;
      }
    }

    if (body.error === 'missing_api_key') {
      rawCalls.push({
        source: 'OKLink proxy',
        note: 'OKLINK_API_KEY not configured on server — falling back.',
      });
    } else if (res.status !== 404 && body.message) {
      readErrors.push(`OKLink proxy: ${String(body.message)}`);
    }
  } catch (err) {
    // Proxy unavailable (static host, offline) — fall through
    const msg = err instanceof Error ? err.message : String(err);
    if (isBrowser() || nodeEnv('SHOMER_API_BASE')) {
      rawCalls.push({
        source: 'OKLink proxy',
        note: `Proxy unreachable: ${msg}`,
      });
    }
  }

  // 2) Node scripts only: call OKLink with env key (never bundled for browser)
  if (!isBrowser()) {
    const key = nodeEnv('OKLINK_API_KEY');
    if (key) {
      try {
        const chain = chainShortName(network);
        const url = `https://www.oklink.com/api/v5/explorer/contract/creation-info?chainShortName=${chain}&contractAddress=${address}`;
        const res = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            'Ok-Access-Key': key,
          },
        });
        const text = await res.text();
        rawCalls.push({
          source: 'OKLink creation-info (node env key)',
          note: `HTTP ${res.status}`,
          raw: text.slice(0, 500),
        });
        const data = JSON.parse(text) as Record<string, unknown>;
        if (String(data.code ?? '0') === '0') {
          const parsed = parseDeployerPayload(data);
          const hit = toDeployerResult(parsed.creator, parsed.txHash, parsed.deployBlock);
          if (hit) return hit;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        readErrors.push(`OKLink authenticated (node): ${msg}`);
      }
    }
  }

  // 3) Public unauthenticated best-effort
  try {
    const chain = chainShortName(network);
    const publicUrl = `https://www.oklink.com/api/v5/explorer/contract/creation-info?chainShortName=${chain}&contractAddress=${address}`;
    const res = await fetch(publicUrl, {
      headers: { 'Content-Type': 'application/json' },
    });
    rawCalls.push({
      source: 'OKLink creation-info (public)',
      note: `HTTP ${res.status}`,
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      rawCalls.push({
        source: 'OKLink public response',
        raw: JSON.stringify(data).slice(0, 600),
      });
      if (String(data.code ?? '0') === '0') {
        const parsed = parseDeployerPayload(data);
        const hit = toDeployerResult(parsed.creator, parsed.txHash, parsed.deployBlock);
        if (hit) return hit;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    readErrors.push(`OKLink deployer lookup (public): ${msg}`);
  }

  readErrors.push(
    'Deployer not available. Set OKLINK_API_KEY in .env and run via npm run dev (server proxy), or declare expected deployer in the Launch Manifest. Keys never ship to the browser.',
  );
  return { deployer: null, txHash: null, deployBlock: null };
}

async function fetchVerification(
  network: XLayerNetwork,
  address: Address,
  explorerBase: string,
  rawCalls: EvidenceRecord[],
): Promise<VerificationStatus> {
  const explorerUrl = `${explorerBase}/address/${address}`;

  // Sourcify multi-chain check
  const chainId = network === 'mainnet' ? 196 : 1952;
  try {
    const sourcifyUrl = `https://sourcify.dev/server/v2/contract/${chainId}/${address}`;
    const res = await fetch(sourcifyUrl);
    rawCalls.push({
      source: `Sourcify ${sourcifyUrl}`,
      raw: `HTTP ${res.status}`,
    });
    if (res.ok) {
      const body = (await res.json()) as { match?: string; status?: string };
      const match = body.match || body.status;
      if (match === 'exact_match' || match === 'match' || match === 'partial_match') {
        return {
          status: 'verified',
          source: 'Sourcify',
          explorerUrl,
          details: String(match),
          evidence: {
            source: 'Sourcify API',
            raw: JSON.stringify(body).slice(0, 400),
          },
        };
      }
    }
    if (res.status === 404) {
      return {
        status: 'unverified',
        source: 'Sourcify',
        explorerUrl,
        details: 'Not found on Sourcify for this chain.',
        evidence: {
          source: 'Sourcify API',
          raw: 'HTTP 404 — contract not verified on Sourcify',
        },
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rawCalls.push({ source: 'Sourcify', note: msg });
  }

  return {
    status: 'unknown',
    source: 'Sourcify',
    explorerUrl,
    details:
      'Could not confirm verification status. Check the OKX explorer manually.',
    evidence: {
      source: 'Sourcify + explorer link',
      note: 'Verification status unknown — not treated as verified.',
      raw: explorerUrl,
    },
  };
}

export async function readFacts(input: ReadFactsInput): Promise<ObservedFacts> {
  const network = input.network;
  const chain = getXLayerChain(network);
  const address = normalizeAddress(input.contractAddress);
  if (!address) {
    throw new Error('Invalid contract address. Provide a checksummed or hex EVM address.');
  }

  const client = clientFor(network);
  const rawCalls: EvidenceRecord[] = [];
  const readErrors: string[] = [];

  const latestBlock = await client.getBlockNumber();
  let blockNumber = latestBlock;
  if (input.blockNumber !== undefined && input.blockNumber !== null && input.blockNumber !== '') {
    let pin: bigint;
    try {
      pin = BigInt(input.blockNumber as string | number | bigint);
    } catch {
      throw new Error('Invalid blockNumber. Provide a non-negative integer.');
    }
    if (pin < 0n) {
      throw new Error('Invalid blockNumber. Provide a non-negative integer.');
    }
    if (pin > latestBlock) {
      throw new Error(
        `blockNumber ${pin.toString()} is ahead of chain head ${latestBlock.toString()}.`,
      );
    }
    blockNumber = pin;
    rawCalls.push({
      source: 'block_pin',
      block: Number(blockNumber),
      note: `Pinned reads to block ${blockNumber.toString()} (head ${latestBlock.toString()})`,
    });
  }
  const block = await client.getBlock({ blockNumber });
  const chainId = await client.getChainId();

  if (chainId !== chain.id) {
    readErrors.push(
      `RPC returned chainId ${chainId}, expected ${chain.id} for ${chain.name}. Results may be wrong.`,
    );
  }
  void chainId; // referenced above for diagnostics

  const bytecode = await client.getBytecode({ address, blockNumber });
  const hasCode = Boolean(bytecode && bytecode !== '0x');
  const codeHash = hasCode && bytecode ? keccak256(bytecode) : null;

  if (!hasCode) {
    readErrors.push('No contract bytecode at this address on the selected network.');
  }

  rawCalls.push({
    source: 'getCode',
    block: Number(blockNumber),
    raw: hasCode ? `bytecode length ${(bytecode!.length - 2) / 2} bytes; codehash ${codeHash}` : 'empty',
  });

  const { owner, method: ownerReadMethod } = hasCode
    ? await readOwner(client, address, blockNumber, rawCalls, readErrors)
    : { owner: null, method: null };

  let isOwnerContract: boolean | null = null;
  let isSafe: boolean | null = null;
  let safeThreshold: number | null = null;
  let safeOwners: Address[] | null = null;
  let safeEvidence: EvidenceRecord | null = null;

  if (owner) {
    const ownerCode = await client.getBytecode({ address: owner, blockNumber });
    isOwnerContract = Boolean(ownerCode && ownerCode !== '0x');
    if (isOwnerContract) {
      const safe = await probeSafe(client, owner, blockNumber, rawCalls, readErrors);
      isSafe = safe.isSafe;
      safeThreshold = safe.threshold;
      safeOwners = safe.owners;
      safeEvidence = safe.evidence;
    } else {
      isSafe = false;
      safeEvidence = {
        source: 'getCode(owner)',
        raw: 'EOA',
        note: 'Owner is an EOA (no bytecode).',
      };
    }
  }

  const proxy = hasCode
    ? await readProxySlots(client, address, blockNumber, rawCalls, readErrors)
    : {
        isProxy: null,
        implementation: null,
        proxyAdmin: null,
        implementationCodeHash: null,
        evidence: null,
      };

  // Upgrade authority: transparent proxy admin, else owner for UUPS-style
  let upgradeAuthority: Address | null = null;
  if (proxy.proxyAdmin) {
    upgradeAuthority = proxy.proxyAdmin;
  } else if (proxy.isProxy && owner) {
    upgradeAuthority = owner;
  }

  const timelock = await readTimelock(
    client,
    [owner, proxy.proxyAdmin, upgradeAuthority],
    blockNumber,
    rawCalls,
    readErrors,
  );

  const initializer = hasCode
    ? await readInitializer(client, address, blockNumber, rawCalls, readErrors)
    : { sealed: null, version: null, evidence: null };

  const feeRecipient = hasCode
    ? await readOptionalAddressGetter(client, address, 'feeRecipient', blockNumber, rawCalls, readErrors)
    : null;
  const treasury = hasCode
    ? await readOptionalAddressGetter(client, address, 'treasury', blockNumber, rawCalls, readErrors)
    : null;
  const oracle = hasCode
    ? await readOptionalAddressGetter(client, address, 'oracle', blockNumber, rawCalls, readErrors)
    : null;
  const router = hasCode
    ? await readOptionalAddressGetter(client, address, 'router', blockNumber, rawCalls, readErrors)
    : null;
  const factory = hasCode
    ? await readOptionalAddressGetter(client, address, 'factory', blockNumber, rawCalls, readErrors)
    : null;
  const pool = hasCode
    ? await readOptionalAddressGetter(client, address, 'pool', blockNumber, rawCalls, readErrors)
    : null;
  const minterAddr = hasCode
    ? await readOptionalAddressGetter(client, address, 'minter', blockNumber, rawCalls, readErrors)
    : null;

  let feeBps: number | null = null;
  let slippageBps: number | null = null;
  if (hasCode) {
    feeBps = await readOptionalUintGetter(client, address, 'feeBps', blockNumber, rawCalls, readErrors);
    if (feeBps === null) {
      // Some contracts expose fee() already in bps or 1e6 scale — store raw number; engine compares carefully
      feeBps = await readOptionalUintGetter(client, address, 'fee', blockNumber, rawCalls, readErrors);
    }
    slippageBps = await readOptionalUintGetter(
      client,
      address,
      'maxSlippageBps',
      blockNumber,
      rawCalls,
      readErrors,
    );
  }

  const pendingOwner = hasCode
    ? await readPendingOwner(client, address, blockNumber, rawCalls, readErrors)
    : null;

  const proxyKind = hasCode
    ? await detectProxyKind(
        client,
        address,
        proxy.isProxy,
        proxy.proxyAdmin,
        blockNumber,
        rawCalls,
      )
    : null;

  let totalSupply: string | null = null;
  if (hasCode) {
    const supply = await safeCall(
      'totalSupply()',
      () =>
        client.readContract({
          address,
          abi: commonGettersAbi,
          functionName: 'totalSupply',
          blockNumber,
        }),
      rawCalls,
      readErrors,
    );
    if (supply !== null) totalSupply = supply.toString();
  }

  const tokenName = hasCode
    ? await readOptionalStringGetter(client, address, 'name', blockNumber, rawCalls, readErrors)
    : null;
  const tokenSymbol = hasCode
    ? await readOptionalStringGetter(client, address, 'symbol', blockNumber, rawCalls, readErrors)
    : null;

  const oracleUpdatedAt = hasCode
    ? await readOracleUpdatedAt(client, oracle, blockNumber, rawCalls, readErrors)
    : null;

  // Safe probe on upgrade authority when it is a contract (not only owner)
  let upgradeAuthorityIsSafe: boolean | null = null;
  let upgradeAuthoritySafeThreshold: number | null = null;
  if (upgradeAuthority && upgradeAuthority !== owner) {
    const uaCode = await client.getBytecode({ address: upgradeAuthority, blockNumber });
    if (uaCode && uaCode !== '0x') {
      const uaSafe = await probeSafe(client, upgradeAuthority, blockNumber, rawCalls, readErrors);
      upgradeAuthorityIsSafe = uaSafe.isSafe;
      upgradeAuthoritySafeThreshold = uaSafe.threshold;
    } else {
      upgradeAuthorityIsSafe = false;
    }
  } else if (upgradeAuthority && upgradeAuthority === owner) {
    upgradeAuthorityIsSafe = isSafe;
    upgradeAuthoritySafeThreshold = safeThreshold;
  }

  const deploy = await fetchDeployer(
    network,
    address,
    rawCalls,
    readErrors,
    input.proxyBase,
  );
  const verification = await fetchVerification(
    network,
    address,
    chain.blockExplorers.default.url,
    rawCalls,
  );

  const addressSanityFlags: string[] = [];
  if (!hasCode) addressSanityFlags.push('no_code');
  if (isZeroOrPlaceholder(address)) addressSanityFlags.push('contract_is_zero_or_dead');
  if (owner && isZeroOrPlaceholder(owner)) addressSanityFlags.push('owner_is_zero_or_dead');
  if (proxy.implementation && isZeroOrPlaceholder(proxy.implementation)) {
    addressSanityFlags.push('implementation_is_zero_or_dead');
  }
  if (feeRecipient && isZeroOrPlaceholder(feeRecipient)) {
    addressSanityFlags.push('fee_recipient_is_zero_or_dead');
  }
  if (treasury && isZeroOrPlaceholder(treasury)) {
    addressSanityFlags.push('treasury_is_zero_or_dead');
  }
  if (pendingOwner && isZeroOrPlaceholder(pendingOwner)) {
    addressSanityFlags.push('pending_owner_is_zero_or_dead');
  }

  const knownAddrs = [
    owner,
    proxy.proxyAdmin,
    upgradeAuthority,
    feeRecipient,
    treasury,
    minterAddr,
    pendingOwner,
  ].filter(Boolean) as Address[];
  const roles = hasCode
    ? await enumerateAccessControlRoles(client, address, blockNumber, rawCalls, readErrors, knownAddrs)
    : [];

  // Collect minter holders from minter() + MINTER_ROLE
  let minterHolders: Address[] | null = null;
  const minterSet = new Set<string>();
  if (minterAddr) minterSet.add(minterAddr);
  for (const ro of roles) {
    if (ro.role === 'MINTER_ROLE') {
      for (const h of ro.holders) minterSet.add(h);
    }
  }
  if (minterSet.size > 0) minterHolders = [...minterSet] as Address[];

  return {
    network,
    chainId,
    blockNumber: Number(blockNumber),
    timestamp: Number(block.timestamp),
    contractAddress: address,
    codeHash,
    hasCode,
    deployer: deploy.deployer,
    deployTxHash: deploy.txHash,
    deployBlock: deploy.deployBlock,
    owner,
    ownerReadMethod,
    isOwnerContract,
    isSafe,
    safeThreshold,
    safeOwners,
    safeEvidence,
    isProxy: proxy.isProxy,
    implementation: proxy.implementation,
    implementationCodeHash: proxy.implementationCodeHash,
    proxyAdmin: proxy.proxyAdmin,
    upgradeAuthority,
    upgradeEvidence: proxy.evidence,
    timelockAddress: timelock.address,
    timelockMinDelaySec: timelock.minDelay,
    timelockEvidence: timelock.evidence,
    initializerSealed: initializer.sealed,
    initializedVersion: initializer.version,
    initializerEvidence: initializer.evidence,
    totalSupply,
    tokenName,
    tokenSymbol,
    feeRecipient,
    treasury,
    minterHolders,
    factory,
    pool,
    feeBps,
    slippageBps,
    oracle,
    oracleUpdatedAt,
    router,
    pendingOwner,
    proxyKind,
    upgradeAuthorityIsSafe,
    upgradeAuthoritySafeThreshold,
    roles,
    addressSanityFlags,
    verification,
    rawCalls,
    readErrors,
  };
}
