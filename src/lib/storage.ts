import {
  emptyManifest,
  emptyPolicyState,
  type ManifestFields,
  type ObservedFacts,
  type PolicyState,
  type ScanRun,
} from './policy/types';

const POLICY_KEY = 'shomer.policy.v2';
const LAST_SCAN_KEY = 'shomer.lastScan.v2';
const LAST_FACTS_KEY = 'shomer.lastFacts.v1';
/** Legacy keys — migrated once. */
const LEGACY_MANIFEST_KEY = 'shomer.manifest.v1';
const LEGACY_SCAN_KEY = 'shomer.lastScan.v1';

export function loadPolicyState(): PolicyState {
  try {
    const raw = localStorage.getItem(POLICY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PolicyState;
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
  localStorage.setItem(POLICY_KEY, JSON.stringify(state));
}

export function loadLastScan(): ScanRun | null {
  try {
    const raw = localStorage.getItem(LAST_SCAN_KEY);
    if (raw) return JSON.parse(raw) as ScanRun;
    // Ignore legacy scans that lacked manifestVersion — force re-verify under new loop
    const legacy = localStorage.getItem(LEGACY_SCAN_KEY);
    if (legacy) return null;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveLastScan(scan: ScanRun): void {
  localStorage.setItem(LAST_SCAN_KEY, JSON.stringify(scan));
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

export function loadLastFacts(): ObservedFacts | null {
  try {
    const raw = localStorage.getItem(LAST_FACTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ObservedFacts;
  } catch {
    return null;
  }
}

export function saveLastFacts(facts: ObservedFacts): void {
  localStorage.setItem(LAST_FACTS_KEY, JSON.stringify(facts));
}

// —— Back-compat aliases used during transition ——
export function loadManifest(): ManifestFields {
  return loadPolicyState().draft;
}

export function saveManifest(manifest: ManifestFields): void {
  const state = loadPolicyState();
  savePolicyState({ ...state, draft: manifest });
}
