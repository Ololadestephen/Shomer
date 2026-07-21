import type { ManifestFieldKey, ManifestFields } from './types';
import { isEmptyField } from '../utils/address';

export interface PolicyFieldDiff {
  key: ManifestFieldKey;
  from: string;
  to: string;
  kind: 'added' | 'removed' | 'changed';
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return s.trim() === '' ? '—' : s;
}

function isUnset(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'boolean') return false;
  if (typeof v === 'number') return false;
  return isEmptyField(String(v));
}

/**
 * Diff two policy snapshots (e.g. approved v1 vs current draft before approve v2).
 * Pure — no RPC.
 */
export function diffManifestFields(
  from: ManifestFields,
  to: ManifestFields,
  keys?: ManifestFieldKey[],
): PolicyFieldDiff[] {
  const allKeys = (keys ?? (Object.keys(from) as ManifestFieldKey[])).filter(
    (k) => k !== 'projectName', // optional: still include projectName
  );
  // Always include identity + policy keys from both
  const keySet = new Set<ManifestFieldKey>([
    ...allKeys,
    ...(Object.keys(to) as ManifestFieldKey[]),
  ]);

  const out: PolicyFieldDiff[] = [];
  for (const key of keySet) {
    if (key === 'network' || key === 'contractAddress') {
      // include if changed
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (from as any)[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (to as any)[key];
    const aEmpty = isUnset(a);
    const bEmpty = isUnset(b);
    if (aEmpty && bEmpty) continue;
    if (displayValue(a) === displayValue(b)) continue;
    let kind: PolicyFieldDiff['kind'] = 'changed';
    if (aEmpty && !bEmpty) kind = 'added';
    else if (!aEmpty && bEmpty) kind = 'removed';
    out.push({
      key,
      from: displayValue(a),
      to: displayValue(b),
      kind,
    });
  }

  // Stable order: control plane first
  const order: ManifestFieldKey[] = [
    'owner',
    'expectedSafe',
    'minMultisigThreshold',
    'upgradeable',
    'expectedProxyAdminOrUpgradeAuthority',
    'expectedImplementation',
    'expectedImplementationCodeHash',
    'timelockRequired',
    'minTimelockDelaySec',
    'expectedDeployer',
    'maxTokenSupply',
    'mintingAllowedAfterLaunch',
    'treasury',
    'feeRecipient',
    'maxFeeBps',
    'approvedRouters',
    'approvedFactories',
    'approvedPools',
    'oracle',
    'maxOracleStalenessSec',
    'projectName',
    'network',
    'contractAddress',
  ];
  out.sort((x, y) => {
    const ix = order.indexOf(x.key);
    const iy = order.indexOf(y.key);
    return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
  });
  return out;
}
