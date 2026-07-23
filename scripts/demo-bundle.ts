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
    service: 'Shomer Verify',
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
      service: 'Shomer Deep Verify',
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
    priceUsd: '0.05',
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
    'Shomer Deep Verify — X Layer privilege map, artifact match, Auditor Brief',
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
      amount: accepts[0]?.amount ?? '50000',
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
        // Historical production settle was $0.01; current list/challenge price is $0.05
        amountUsd: '0.01',
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

This is the final judge-facing recording plan. Record the product, evidence, and live listing—not setup work.
Use a clean browser profile and a large editor font. **Never** show \`.env\`, payment signatures, receipt capabilities, or API keys.

---

## Recording workflow

1. Record the eight short shots below separately; do not attempt one continuous take.
2. Capture at 1920×1080 with the browser at 100% zoom and notifications disabled.
3. Keep the pointer still unless it is directing attention to a verdict or evidence field.
4. Record the voice-over after the screen capture so every cut lands on the spoken proof.
5. Use hard cuts or very short dissolves. Avoid decorative transitions, fake dashboards, and long typing sequences.
6. Export H.264 at 1080p, 30 fps, 8–12 Mbps. Keep the final runtime between 82 and 88 seconds.

---

## Timeline (≤90s)

| Time | Shot | On screen | Say / caption |
| --- | --- | --- | --- |
| **0–7s** | Hook | ${PUBLIC_UI} — hold on the hero | “Is this the deployment you approved? Shomer is the X Layer ship gate for founders and agents.” |
| **7–18s** | The comparison | Landing checks or app policy view | “It compares live ownership, Safe, upgrade authority, timelock, and implementation with the policy you locked.” |
| **18–30s** | Policy Matched | \`matched.json\`: verdict, block, owner evidence | “The correct approved owner at pinned block ${by.matched?.blockNumber} returns **Policy Matched**—with evidence, never a safety claim.” |
| **30–42s** | Blocked | \`blocked.json\`: expected and actual owner | “Change only the approved owner and the same deployment is **Blocked**. An agent must not ship or trust it.” |
| **42–53s** | Review Required | \`review.json\`: undeclared pauser role | “An undeclared privilege becomes **Review Required**. Shomer never turns missing policy into a green check.” |
| **53–68s** | Paid proof | \`paid-artifact-match.sanitized.json\`: artifact match, privilege map, brief ID | “Deep Verification adds the privilege map, reviewed runtime-hash match, and a human-ready Auditor Brief.” |
| **68–80s** | Payment + recovery | \`payment-proof.sanitized.json\`: transaction, recovered report | “The paid call settles 0.05 USDC on X Layer. If the response is lost, the persisted report is recovered without charging twice.” |
| **80–88s** | Listed product | https://www.okx.ai/agents/6117 — Shomer listing | “Shomer is live as OKX.AI ASP **#6117**: free verification and paid Deep Verification.” |

End on the listed agent page for at least two seconds. Do not end on code or a terminal.

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
- [ ] Browser at 100%; editor/JSON font at least 18 px
- [ ] Hide bookmarks, personal tabs, notifications, wallet balances, and email
- [ ] Warm one free verify before the take
- [ ] Bundle files pre-opened in tabs
- [ ] No \`.env\`, wrangler secrets, or payment authorization headers visible
- [ ] Keep each evidence shot focused on 2–4 fields; do not scroll walls of JSON
- [ ] Voice is louder than music; no music is also acceptable
- [ ] End freeze on the approved ASP #6117 listing

## What to highlight in each evidence file

| File | Keep visible |
| --- | --- |
| \`matched.json\` | \`verdict\`, \`blockNumber\`, owner check, evidence source |
| \`blocked.json\` | expected owner, actual owner, exact remediation |
| \`review.json\` | undeclared role and why human review is required |
| \`paid-artifact-match.sanitized.json\` | \`artifactComparison.status\`, runtime hash, privilege map, brief ID |
| \`payment-proof.sanitized.json\` | public transaction hash and recovered-report result |

Blur nothing in post-production. If a field is sensitive, do not capture it in the first place.

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

1. Watch once with sound and once muted; the captions and visible fields should still tell the story.
2. Confirm runtime is below 90 seconds and the export is 1080p.
3. Attach the video to the submission/X post and link ${PUBLIC_UI}, ${PUBLIC_BASE}/api/agent, and https://www.okx.ai/agents/6117.
4. Submit before **July 27**.

Product boundaries: [FREE-VS-PAID.md](../../FREE-VS-PAID.md) · Agent integration: [AGENT-SKILL.md](../../AGENT-SKILL.md)
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
