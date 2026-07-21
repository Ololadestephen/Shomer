import type { CheckResult, CheckStatus, Coverage, SkipReason, Verdict } from '../policy/types';

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case 'blocked':
      return 'Blocked';
    case 'review_required':
      return 'Review Required';
    case 'policy_matched':
      return 'Policy Matched';
  }
}

/** Short plain-language gloss under technical verdict labels */
export function verdictPlainEnglish(v: Verdict): string {
  switch (v) {
    case 'blocked':
      return 'Does not match the rules you locked — do not treat as approved.';
    case 'review_required':
      return 'Some items need a human look — not a clean match.';
    case 'policy_matched':
      return 'Matches the rules you locked (still not an audit or “safe”).';
  }
}

export function statusLabel(s: CheckStatus, skipReason?: SkipReason): string {
  switch (s) {
    case 'blocked':
      return 'BLOCKED';
    case 'review':
      return 'REVIEW';
    case 'matched':
      return 'MATCHED';
    case 'skipped':
      if (skipReason === 'out_of_scope') return 'OUT OF SCOPE';
      if (skipReason === 'evidence_missing') return 'EVIDENCE MISSING';
      return 'SKIPPED';
  }
}

export function statusTagClass(s: CheckStatus, skipReason?: SkipReason): string {
  switch (s) {
    case 'blocked':
      return 'tag-block';
    case 'review':
      return 'tag-review';
    case 'matched':
      return 'tag-pass';
    case 'skipped':
      if (skipReason === 'evidence_missing') return 'tag-skip-missing';
      if (skipReason === 'out_of_scope') return 'tag-skip-scope';
      return 'tag-skip';
  }
}

export function checkStatusLabel(r: CheckResult): string {
  return statusLabel(r.status, r.skipReason);
}

export function checkStatusTagClass(r: CheckResult): string {
  return statusTagClass(r.status, r.skipReason);
}

export function verdictOrbClass(v: Verdict): string {
  switch (v) {
    case 'blocked':
      return 'blocked';
    case 'review_required':
      return 'review';
    case 'policy_matched':
      return 'pass';
  }
}

export function verdictEyebrowClass(v: Verdict): string {
  switch (v) {
    case 'blocked':
      return 'red';
    case 'review_required':
      return 'amber';
    case 'policy_matched':
      return 'green';
  }
}

export function coveragePercent(c: Coverage): number {
  if (c.total === 0) return 0;
  // Out of scope is not in the denominator. Evidence-missing and review/blocked are.
  const outOfScope = c.outOfScope ?? 0;
  const applicable = c.total - outOfScope;
  if (applicable <= 0) return 0;
  return Math.round((c.matched / applicable) * 100);
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function networkLabel(n: 'mainnet' | 'testnet'): string {
  return n === 'mainnet' ? 'X Layer Mainnet' : 'X Layer Testnet';
}
