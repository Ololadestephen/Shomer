/**
 * Build a sanitized demo evidence pack for the 90s recording.
 *
 * Offline by default (pinned fixtures) — no RPC, no payment, no secrets.
 * Output: docs/demo/bundle/
 *
 *   npm run demo:bundle
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Address, type Hex } from 'viem';
import { runAgentVerify } from '../server/agentVerify';
import {
  buildPaymentRequired,
  type X402Config,
} from '../server/x402';
import {
  FIXTURE_CONTRACT,
  FIXTURE_OWNER,
  makeObservedFacts,
} from './fixtures/observedFacts';

const OUT_DIR = join(process.cwd(), 'docs/demo/bundle');
const WRONG_OWNER = '0x3333333333333333333333333333333333333333' as Address;
const RUNTIME_HASH = (`0x${'ab'.repeat(32)}`) as Hex;
const PUBLIC_BASE = 'https://shomer-agent-api.mixed-mouse.workers.dev';
const PUBLIC_UI = 'https://shomer-ui.pages.dev';
const PRODUCTION_CONTRACT =
  '0x5839244eab49314bccc0fa76e3a081cb1a461111';
const PRODUCTION_PAYMENT_TX =
  '0x665b7725059f61140ff2f39388feb7120e27691102c5cce05f7e7ea87a547987';
const PRODUCTION_REPORT_ID = 'shomer-196-65954437-1ba7f41efd1f';
const PRODUCTION_BLOCK = 65_954_437;
const PRODUCTION_RUNTIME_HASH =
  '0x3b19c4c11b459cd1e52f991bbbe78a64b869aeaa7f483f3ab0c12d84120eee64';

type PathLabel = 'matched' | 'blocked' | 'review';

function sanitizeDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (
      k.includes('authorization') ||
      k.includes('signature') ||
      k.includes('secret') ||
      k.includes('passphrase') ||
      k.includes('apikey') ||
      k === 'x-payment' ||
      k === 'payment-signature' ||
      k === 'payment-response' ||
      k === 'okx_api_key' ||
      k === 'okx_secret_key' ||
      k === 'okx_passphrase'
    ) {
      continue;
    }
    if (k === 'readerrors' && Array.isArray(raw)) {
      out[key] = (raw as string[]).slice(0, 4);
      continue;
    }
    if (k === 'rawcalls' && Array.isArray(raw)) {
      out[key] = (raw as unknown[]).slice(0, 8);
      continue;
    }
    out[key] = sanitizeDeep(raw);
  }
  return out;
}

function writeJson(name: string, data: unknown) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, `${JSON.stringify(sanitizeDeep(data), null, 2)}\n`, 'utf8');
  console.log('wrote', path);
}

function writeText(name: string, text: string) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  console.log('wrote', path);
}

async function runPath(label: PathLabel, opts: {
  owner: string;
  undeclaredPrivilege?: boolean;
  projectName: string;
}) {
  const facts = makeObservedFacts(
    opts.undeclaredPrivilege
      ? {
          roles: [
            {
              role: 'PAUSER_ROLE',
              holders: [FIXTURE_OWNER],
              evidence: {
                source: 'getRoleMember(PAUSER_ROLE)',
                block: 12_345,
                raw: FIXTURE_OWNER,
              },
            },
          ],
        }
      : {},
  );

  const result = await runAgentVerify(
    {
      network: 'mainnet',
      contractAddress: FIXTURE_CONTRACT,
      projectName: opts.projectName,
      blockNumber: facts.blockNumber,
      policy: {
        owner: opts.owner,
        upgradeable: false,
      },
      reviewedArtifact: {
        name: 'Pinned reviewed runtime (demo)',
        reviewedCommit: 'demo-reviewed-commit',
        runtimeCodeHash: RUNTIME_HASH,
      },
    },
    'paid',
    {
      facts,
      inspectRelatedAddresses: async () => [
        {
          address: FIXTURE_OWNER,
          hasCode: false,
          codeHash: null,
          bytecodeSize: 0,
          evidence: {
            source: 'demo privilege probe',
            block: facts.blockNumber,
            raw: 'EOA',
          },
        },
      ],
    },
  );

  if (result.status !== 200 || !result.body.ok) {
    throw new Error(`${label}: verify failed status=${result.status}`);
  }

  const body = result.body;
  const brief = body.deepVerification?.auditorBrief;
  if (!brief) throw new Error(`${label}: missing auditorBrief`);

  // Compact free-style report for terminal screenshots
  const freeReport = {
    demoPath: label,
    service: 'shomer-verify (free-equivalent verdict surface)',
    aspId: '6117',
    tier: 'free',
    network: body.network,
    chainId: body.chainId,
    contractAddress: body.contractAddress,
    blockNumber: body.blockNumber,
    verdict: body.verdict,
    coverage: body.coverage,
    policyHash: body.policyHash,
    projectName: opts.projectName,
    facts: {
      owner: body.facts.owner,
      isProxy: body.facts.isProxy,
      codeHash: body.facts.codeHash,
      hasCode: body.facts.hasCode,
      verification: body.facts.verification,
      tokenName: body.facts.tokenName,
      tokenSymbol: body.facts.tokenSymbol,
    },
    results: (body.results ?? [])
      .filter((r) => r.status !== 'skipped' || r.skipReason === 'evidence_missing')
      .map((r) => ({
        checkKey: r.checkKey,
        status: r.status,
        skipReason: r.skipReason,
        title: r.title,
        expected: r.expected,
        actual: r.actual,
        why: r.why,
        remediation: r.remediation,
        evidence: r.evidence
          ? {
              source: r.evidence.source,
              block: r.evidence.block,
              note: r.evidence.note,
            }
          : undefined,
      })),
    disclaimer: body.disclaimer,
  };

  writeJson(`${label}.json`, freeReport);
  writeText(`${label}.brief.md`, brief.markdown);

  // Full paid deep package for matched path (artifact proof)
  if (label === 'matched') {
    const paidProof = {
      demoPath: 'paid-artifact-match',
      service: 'shomer-verify-paid',
      aspId: '6117',
      tier: 'paid',
      network: body.network,
      chainId: body.chainId,
      contractAddress: body.contractAddress,
      blockNumber: body.blockNumber,
      verdict: body.verdict,
      coverage: body.coverage,
      policyHash: body.policyHash,
      reviewedArtifact: {
        name: 'Pinned reviewed runtime (demo)',
        reviewedCommit: 'demo-reviewed-commit',
        runtimeCodeHash: RUNTIME_HASH,
        note: 'Hash matches live runtime codeHash at pinned block (fixture).',
      },
      deepVerification: {
        version: body.deepVerification?.version,
        features: body.deepVerification?.features,
        artifactComparison: body.deepVerification?.artifactComparison,
        privilegeMap: {
          rootAddress: body.deepVerification?.privilegeMap.rootAddress,
          blockNumber: body.deepVerification?.privilegeMap.blockNumber,
          nodeCount: body.deepVerification?.privilegeMap.nodes.length,
          edgeCount: body.deepVerification?.privilegeMap.edges.length,
          nodes: body.deepVerification?.privilegeMap.nodes.slice(0, 6),
          edges: body.deepVerification?.privilegeMap.edges.slice(0, 8),
          limitations: body.deepVerification?.privilegeMap.limitations,
        },
        auditorBrief: {
          reportId: brief.reportId,
          contentDigest: brief.contentDigest,
          verdict: brief.verdict,
          scope: brief.scope,
          findingsCount: brief.findings.length,
          markdownPath: 'matched.brief.md',
        },
      },
      disclaimer: body.disclaimer,
      sanitization:
        'No payment authorization headers, API keys, or facilitator secrets included.',
    };
    writeJson('paid-artifact-match.sanitized.json', paidProof);
  }

  return {
    label,
    verdict: body.verdict,
    blockNumber: body.blockNumber,
    reportId: brief.reportId,
    contentDigest: brief.contentDigest,
    artifactStatus: body.deepVerification?.artifactComparison.status,
  };
}

function paymentProofSanitized() {
  // Fixed public values keep the offline bundle deterministic and prevent the
  // recorder's shell environment from changing what appears on screen.
  const cfg: X402Config = {
    payTo: '0x07cff11194d054a17e7e9ebee87a744830404d17',
    priceUsd: '0.01',
    network: 'eip155:196',
    asset: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
    assetName: 'USD Coin',
    assetVersion: '2',
    facilitatorUrl: 'https://web3.okx.com/api/v6/pay/x402',
    devBypass: false,
  };

  const resource = `${PUBLIC_BASE}/api/agent/verify/paid`;
  const challenge = buildPaymentRequired(
    cfg,
    resource,
    'Shomer paid X Layer Deep Verification',
  );

  const accepts = Array.isArray(challenge.accepts)
    ? (challenge.accepts as Record<string, unknown>[])
    : [];

  const proof = {
    demoPath: 'payment-proof',
    note: 'Sanitized unpaid challenge + production settlement proof. No PAYMENT-SIGNATURE, receipt capability, or authorization material.',
    unpaidChallenge: {
      httpStatus: 402,
      x402Version: challenge.x402Version ?? 2,
      error: challenge.error ?? 'payment_required',
      network: accepts[0]?.network ?? cfg.network,
      asset: accepts[0]?.asset ?? cfg.asset,
      amount: accepts[0]?.amount ?? '10000',
      payTo: accepts[0]?.payTo ?? cfg.payTo,
      resource,
      freeAlternative: `${PUBLIC_BASE}/api/agent/verify`,
      accepts: accepts.map((a) => ({
        scheme: a.scheme,
        network: a.network,
        amount: a.amount,
        asset: a.asset,
        payTo: a.payTo,
        description: a.description,
        // strip any nested sensitive fields if present
      })),
    },
    settledReceipt: {
      httpStatus: 200,
      tier: 'paid',
      payment: {
        settled: true,
        mode: 'facilitator_settled',
        network: cfg.network,
        amountUsd: cfg.priceUsd,
        asset: 'USDC',
        transactionHash: PRODUCTION_PAYMENT_TX,
        transactionStatus: 'SUCCESS',
      },
      recoveredReport: {
        contractAddress: PRODUCTION_CONTRACT,
        reportId: PRODUCTION_REPORT_ID,
        blockNumber: PRODUCTION_BLOCK,
        artifactComparison: 'matched',
        runtimeCodeHash: PRODUCTION_RUNTIME_HASH,
        verdict: 'blocked',
        verdictReason:
          'Observed owner is the zero address; artifact identity does not override policy blockers.',
      },
      recoveryNote:
        'The persisted report was recovered after the original client response was lost. No second payment was made.',
    },
    recordingTip:
      'On camera: show 402 challenge first, then jump to sanitized paid JSON (artifact match) without scrolling secrets.',
  };

  writeJson('payment-proof.sanitized.json', proof);
  return proof;
}

function shotlist(meta: Array<{
  label: string;
  verdict: string;
  blockNumber: number;
  reportId: string;
  artifactStatus?: string;
}>) {
  const by = Object.fromEntries(meta.map((m) => [m.label, m]));
  const text = `# Shomer 90-second demo shot list

**ASP:** #6117  
**Public UI:** ${PUBLIC_UI}  
**Public API:** ${PUBLIC_BASE}  
**Bundle dir:** \`docs/demo/bundle/\`  
**Generated:** ${new Date().toISOString()}

Open files with a large font. Prefer \`jq\` / VS Code / Preview. **Never** show \`.env\`, payment signatures, or API keys.

---

## Timeline (≤90s)

| Time | Shot | On screen | Say / caption |
| --- | --- | --- | --- |
| **0–8s** | Landing | ${PUBLIC_UI} — Ship Gate hero | “Shomer is the X Layer Ship Gate — is this the deployment you approved?” |
| **8–22s** | Policy Matched | \`matched.json\` + scroll verdict/coverage | “Explicit approved policy, pinned block ${by.matched?.blockNumber}. **Policy Matched** — evidence, not vibes.” |
| **22–38s** | Blocked | \`blocked.json\` — owner_matches blocked | “Wrong owner vs locked rules → **Blocked**. Agents must not ship.” |
| **38–52s** | Review Required | \`review.json\` — undeclared privilege | “Undeclared privilege → **Review Required**. We never invent a pass.” |
| **52–70s** | Paid artifact match | \`paid-artifact-match.sanitized.json\` + brief header | “Paid Deep Verification: privilege map + reviewed runtime hash **${by.matched?.artifactStatus ?? 'matched'}** + auditor brief.” |
| **70–80s** | Payment proof | \`payment-proof.sanitized.json\` — 402 + receipt shape | “x402 on X Layer USDC ~$0.01. Free alternative always linked. No secrets on screen.” |
| **80–88s** | Recover | \`payment-proof.sanitized.json\` — settledReceipt.recoveredReport | “The client lost its response; Shomer recovered the persisted report without a second payment.” |
| **88–90s** | End card | https://www.okx.ai/agents/6117 | “ASP **#6117** — free ship-gate, paid deep verification. Not audited. Not safe.” |

---

## Files to open while recording

| File | Use |
| --- | --- |
| \`${PUBLIC_UI}\` | Opening + brand |
| \`matched.json\` | Green path |
| \`blocked.json\` | Wrong owner |
| \`review.json\` | Undeclared privilege |
| \`matched.brief.md\` | Auditor brief scroll (optional cutaway) |
| \`paid-artifact-match.sanitized.json\` | Paid climax |
| \`payment-proof.sanitized.json\` | 402 + sanitized receipt |
| OKX agent page | End card |

---

## Golden path summary

| Path | Verdict | Brief ID | Artifact |
| --- | --- | --- | --- |
| matched | ${by.matched?.verdict} | ${by.matched?.reportId ?? '—'} | ${by.matched?.artifactStatus ?? '—'} |
| blocked | ${by.blocked?.verdict} | ${by.blocked?.reportId ?? '—'} | — |
| review | ${by.review?.verdict} | ${by.review?.reportId ?? '—'} | — |

All three free-style reports use the **same pinned fixture block** (${by.matched?.blockNumber}) so re-cuts stay consistent.

---

## Rehearsal checklist (clean browser / terminal)

- [ ] Only public URLs (Pages + Worker) — no localhost
- [ ] Large terminal font; \`jq '{verdict,coverage,policyHash,facts}'\` for live curls if needed
- [ ] Warm one free verify before the take
- [ ] Bundle files pre-opened in tabs
- [ ] No \`.env\`, wrangler secrets, or payment authorization headers visible
- [ ] End freeze on ASP #6117

## Optional live curls (not required if using bundle)

\`\`\`bash
# Free verify (warm)
curl -sS -X POST ${PUBLIC_BASE}/api/agent/verify \\
  -H 'Content-Type: application/json' \\
  -d '{"network":"mainnet","contractAddress":"0xcA11bde05977b3631167028862bE2a173976CA11"}' \\
  | jq '{verdict,coverage,blockNumber,policyHash}'

# Paid challenge only (402 — safe)
curl -i -X POST ${PUBLIC_BASE}/api/agent/verify/paid \\
  -H 'Content-Type: application/json' \\
  -d '{"network":"mainnet","contractAddress":"0xcA11bde05977b3631167028862bE2a173976CA11"}'
\`\`\`

---

## Submit

1. Record ≤90s from this shot list  
2. Google form + X post with #OKXAI before **July 27**  
3. Attach video; link free API + https://www.okx.ai/agents/6117  

See also: [DEMO-AND-X-POST.md](../DEMO-AND-X-POST.md) · [FREE-VS-PAID.md](../FREE-VS-PAID.md) · [AGENT-SKILL.md](../AGENT-SKILL.md)
`;

  writeText('DEMO-SHOTLIST.md', text);
}

// —— main ——
mkdirSync(OUT_DIR, { recursive: true });
console.log('Building sanitized demo bundle →', OUT_DIR);

const matched = await runPath('matched', {
  owner: FIXTURE_OWNER,
  projectName: 'Demo — Policy Matched',
});
const blocked = await runPath('blocked', {
  owner: WRONG_OWNER,
  projectName: 'Demo — Wrong owner Blocked',
});
const review = await runPath('review', {
  owner: FIXTURE_OWNER,
  undeclaredPrivilege: true,
  projectName: 'Demo — Undeclared privilege Review',
});

// Assert expected verdicts for the recorder
if (matched.verdict !== 'policy_matched') {
  throw new Error(`expected matched path policy_matched, got ${matched.verdict}`);
}
if (blocked.verdict !== 'blocked') {
  throw new Error(`expected blocked path blocked, got ${blocked.verdict}`);
}
if (review.verdict !== 'review_required') {
  throw new Error(`expected review path review_required, got ${review.verdict}`);
}

paymentProofSanitized();

shotlist([
  { label: 'matched', ...matched },
  { label: 'blocked', ...blocked },
  { label: 'review', ...review },
]);

writeJson('manifest.json', {
  generatedAt: new Date().toISOString(),
  aspId: '6117',
  publicUi: PUBLIC_UI,
  publicApi: PUBLIC_BASE,
  mode: 'offline-fixtures+sanitized-production-proof',
  note: 'Deterministic demo pack with a sanitized existing production receipt. Generation makes no RPC or payment call.',
  files: [
    'matched.json',
    'matched.brief.md',
    'blocked.json',
    'blocked.brief.md',
    'review.json',
    'review.brief.md',
    'paid-artifact-match.sanitized.json',
    'payment-proof.sanitized.json',
    'DEMO-SHOTLIST.md',
    'manifest.json',
  ],
});

console.log('\nDemo bundle ready.');
console.log('Open docs/demo/bundle/DEMO-SHOTLIST.md and start the clean rehearsal.');
