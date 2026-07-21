import {
  type Address,
  type Hex,
  getAddress,
  isAddress,
  isHex,
  zeroAddress,
} from 'viem';
import { DEAD_ADDRESS, ZERO_ADDRESS } from '../chain/xlayer';

export function normalizeAddress(value: string | undefined | null): Address | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('…') || trimmed.includes('...')) return null;
  // Accept non-checksummed or mixed-case hex; never invent addresses.
  if (!isAddress(trimmed, { strict: false })) return null;
  try {
    return getAddress(trimmed.toLowerCase() as Address);
  } catch {
    return null;
  }
}

export function shortAddress(value: string | null | undefined, size = 4): string {
  if (!value) return '—';
  const n = normalizeAddress(value);
  if (!n) {
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
  return `${n.slice(0, 2 + size)}…${n.slice(-size)}`;
}

export function addressesEqual(a?: string | null, b?: string | null): boolean {
  const na = normalizeAddress(a ?? null);
  const nb = normalizeAddress(b ?? null);
  if (!na || !nb) return false;
  return na.toLowerCase() === nb.toLowerCase();
}

export function isEmptyField(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return false;
  return value.trim() === '';
}

export function isZeroOrPlaceholder(addr: Address | string | null | undefined): boolean {
  if (!addr) return false;
  const n = normalizeAddress(addr);
  if (!n) return false;
  return (
    n === zeroAddress ||
    n.toLowerCase() === ZERO_ADDRESS.toLowerCase() ||
    n.toLowerCase() === DEAD_ADDRESS.toLowerCase()
  );
}

export function parseAddressList(raw: string): Address[] {
  if (!raw.trim()) return [];
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const out: Address[] = [];
  for (const p of parts) {
    const n = normalizeAddress(p);
    if (n) out.push(n);
  }
  return out;
}

export function slotToAddress(slotValue: Hex | undefined): Address | null {
  if (!slotValue || !isHex(slotValue)) return null;
  // last 20 bytes
  const hex = slotValue.slice(-40);
  if (hex === '0'.repeat(40)) return null;
  return normalizeAddress(`0x${hex}`);
}

export function formatCodeHash(hash: Hex | null | undefined): string {
  if (!hash) return '—';
  return hash;
}
