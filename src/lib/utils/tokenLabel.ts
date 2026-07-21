/**
 * Build a human project label from optional ERC-20 name/symbol.
 * Returns null when nothing useful is available.
 */
export function suggestedProjectName(
  tokenName: string | null | undefined,
  tokenSymbol: string | null | undefined,
): string | null {
  const name = sanitizeLabel(tokenName);
  const symbol = sanitizeLabel(tokenSymbol);
  if (name && symbol) {
    // Avoid "USDC (USDC)"
    if (name.toLowerCase() === symbol.toLowerCase()) return name;
    return `${name} (${symbol})`;
  }
  if (name) return name;
  if (symbol) return symbol;
  return null;
}

function sanitizeLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).replace(/\0/g, '').trim();
  if (!s) return null;
  // Drop obvious garbage / binary
  if (s.length > 80) s = s.slice(0, 80).trim();
  if (!/[\x20-\x7E]/.test(s)) return null;
  // Reject if mostly non-printable after strip
  const printable = s.replace(/[^\x20-\x7E]/g, '');
  if (printable.length < Math.min(2, s.length)) return null;
  return printable.trim() || null;
}

/** Project names we treat as placeholders (safe to overwrite with onchain label). */
export function isPlaceholderProjectName(name: string | null | undefined): boolean {
  const s = (name ?? '').trim().toLowerCase();
  if (!s) return true;
  return (
    s === 'new verification' ||
    s === 'agent verify' ||
    s === 'smoke test' ||
    s === 'multicall3 sample' ||
    s === 'okxai demo' ||
    s === 'endpoint smoke' ||
    s === 'slice-a'
  );
}
