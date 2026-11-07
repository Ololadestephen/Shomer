import {
  emptyManifest,
  emptyPolicyState,
  type ManifestFields,
  type ObservedFacts,
  type PolicyState,
  type ScanRun,
} from './policy/types';
import { resolveChain } from './chain/chains';

const POLICY_KEY = 'shomer.policy.v2';
const LAST_SCAN_KEY = 'shomer.lastScan.v2';
const LAST_FACTS_KEY = 'shomer.lastFacts.v1';

/** Legacy keys — migrated once. */
const LEGACY_MANIFEST_KEY = 'shomer.manifest.v1';
const LEGACY_SCAN_KEY = 'shomer.lastScan.v1';

export function makeFactsCacheKey(chainId: number, address: string, blockNumber?: number): string {
  const normAddr = address.trim().toLowerCase();
  return blockNumber !== undefined
    ? `shomer.facts.${chainId}.${normAddr}.${blockNumber}`
    : `shomer.facts.${chainId}.${normAddr}`;
}

export function makeScanCacheKey(
  chainId: number,
  address: string,
  manifestVersion?: number,
  blockNumber?: number,
): string {
  const normAddr = address.trim().toLowerCase();
  const v = manifestVersion !== undefined ? `.v${manifestVersion}` : '';
  const b = blockNumber !== undefined ? `.${blockNumber}` : '';
  return `shomer.scan.${chainId}.${normAddr}${v}${b}`;
}

export interface StorageFilter {
  chainId?: number;
  contractAddress?: string;
}

export function loadPolicyState(filter?: StorageFilter): PolicyState {
  try {
    if (filter?.chainId && filter?.contractAddress) {
      const scopedKey = `shomer.policy.${filter.chainId}.${filter.contractAddress.trim().toLowerCase()}`;
      const scopedRaw = localStorage.getItem(scopedKey);
      if (scopedRaw) {
        const parsed = JSON.parse(scopedRaw) as PolicyState;
        return {
          ...emptyPolicyState(),
          ...parsed,
          draft: { ...emptyManifest(), ...parsed.draft },
          provenance: parsed.provenance ?? {},
        };
      }
    }

    const raw = localStorage.getItem(POLICY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PolicyState;
      // If a chain filter is requested, verify the draft network matches the chain
      if (filter?.chainId) {
        try {
          const draftChain = resolveChain(parsed.draft.network);
          if (draftChain.id !== filter.chainId) {
            // Not matching requested chain — return clean state for requested chain
            return emptyPolicyState();
          }
        } catch {
          // ignore
        }
      }
      return {
        ...emptyPolicyState(),
        ...parsed,
        draft: { ...emptyManifest(), ...parsed.draft },
        provenance: parsed.provenance ?? {},
      };
    }
    // Migrate legacy flat manifest → draft only (never treat as approved)
    const legacy = localStorage.getItem(LEGACY_MANIFEST_KEY);
    if (legacy) {
      const fields = { ...emptyManifest(), ...JSON.parse(legacy) } as ManifestFields;
      return emptyPolicyState({ draft: fields });
    }
  } catch {
    /* ignore */
  }
  return emptyPolicyState();
}

export function savePolicyState(state: PolicyState): void {
  try {
    localStorage.setItem(POLICY_KEY, JSON.stringify(state));
    if (state.draft.contractAddress) {
      try {
        const chain = resolveChain(state.draft.network);
        const scopedKey = `shomer.policy.${chain.id}.${state.draft.contractAddress.trim().toLowerCase()}`;
        localStorage.setItem(scopedKey, JSON.stringify(state));
      } catch {
        // ignore
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Loads the last scan.
 * When filter is provided (e.g. chainId), strictly enforces chain isolation
 * so that e.g. BOT Chain never reads cached scans from X Layer.
 */
export function loadLastScan(filter?: StorageFilter): ScanRun | null {
  try {
    // If scoped lookup requested, try scoped key first
    if (filter?.chainId && filter?.contractAddress) {
      const scopedKey = makeScanCacheKey(filter.chainId, filter.contractAddress);
      const scopedRaw = localStorage.getItem(scopedKey);
      if (scopedRaw) {
        const scan = JSON.parse(scopedRaw) as ScanRun;
        if (scan.facts?.chainId === filter.chainId) {
          return scan;
        }
      }
    }

    const raw = localStorage.getItem(LAST_SCAN_KEY);
    if (raw) {
      const scan = JSON.parse(raw) as ScanRun;
      // Enforce chain isolation
      if (filter?.chainId !== undefined && scan.facts?.chainId !== filter.chainId) {
        return null;
      }
      if (
        filter?.contractAddress &&
        scan.contractAddress?.toLowerCase() !== filter.contractAddress.trim().toLowerCase()
      ) {
        return null;
      }
      return scan;
    }
    // Ignore legacy scans that lacked manifestVersion — force re-verify under new loop
    const legacy = localStorage.getItem(LEGACY_SCAN_KEY);
    if (legacy) return null;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveLastScan(scan: ScanRun): void {
  try {
    localStorage.setItem(LAST_SCAN_KEY, JSON.stringify(scan));
    if (scan.facts?.chainId && scan.contractAddress) {
      const key = makeScanCacheKey(
        scan.facts.chainId,
        scan.contractAddress,
        scan.manifestVersion,
        scan.facts.blockNumber,
      );
      localStorage.setItem(key, JSON.stringify(scan));
      // Also save latest for this chain+address
      const latestKey = makeScanCacheKey(scan.facts.chainId, scan.contractAddress);
      localStorage.setItem(latestKey, JSON.stringify(scan));
    }
  } catch {
    /* ignore */
  }
}

export function clearLastScan(): void {
  localStorage.removeItem(LAST_SCAN_KEY);
}

export function clearLastFacts(): void {
  localStorage.removeItem(LAST_FACTS_KEY);
}

/** Full local reset: draft, approved versions, last scan, last facts. Next approve is v1. */
export function clearAllShomerState(): void {
  localStorage.removeItem(POLICY_KEY);
  localStorage.removeItem(LAST_SCAN_KEY);
  localStorage.removeItem(LAST_FACTS_KEY);
  localStorage.removeItem(LEGACY_MANIFEST_KEY);
  localStorage.removeItem(LEGACY_SCAN_KEY);
}

/**
 * Loads the last observed facts.
 * When filter is provided, strictly isolates caches so facts observed
 * on one chain (e.g. X Layer) are NEVER returned for another (e.g. BOT Chain).
 */
export function loadLastFacts(filter?: StorageFilter): ObservedFacts | null {
  try {
    if (filter?.chainId && filter?.contractAddress) {
      const scopedKey = makeFactsCacheKey(filter.chainId, filter.contractAddress);
      const scopedRaw = localStorage.getItem(scopedKey);
      if (scopedRaw) {
        const facts = JSON.parse(scopedRaw) as ObservedFacts;
        if (facts.chainId === filter.chainId) {
          return facts;
        }
      }
    }

    const raw = localStorage.getItem(LAST_FACTS_KEY);
    if (!raw) return null;
    const facts = JSON.parse(raw) as ObservedFacts;
    if (filter?.chainId !== undefined && facts.chainId !== filter.chainId) {
      return null;
    }
    if (
      filter?.contractAddress &&
      facts.contractAddress?.toLowerCase() !== filter.contractAddress.trim().toLowerCase()
    ) {
      return null;
    }
    return facts;
  } catch {
    return null;
  }
}

export function saveLastFacts(facts: ObservedFacts): void {
  try {
    localStorage.setItem(LAST_FACTS_KEY, JSON.stringify(facts));
    if (facts.chainId && facts.contractAddress) {
      const key = makeFactsCacheKey(facts.chainId, facts.contractAddress, facts.blockNumber);
      localStorage.setItem(key, JSON.stringify(facts));
      const latestKey = makeFactsCacheKey(facts.chainId, facts.contractAddress);
      localStorage.setItem(latestKey, JSON.stringify(facts));
    }
  } catch {
    /* ignore */
  }
}

// —— Back-compat aliases used during transition ——
export function loadManifest(): ManifestFields {
  return loadPolicyState().draft;
}

export function saveManifest(manifest: ManifestFields): void {
  const state = loadPolicyState();
  savePolicyState({ ...state, draft: manifest });
}
