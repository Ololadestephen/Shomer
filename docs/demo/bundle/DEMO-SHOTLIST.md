# Shomer 90-second demo shot list

**ASP:** #6117  
**Public UI:** https://shomer-ui.pages.dev  
**Public API:** https://shomer-agent-api.mixed-mouse.workers.dev  
**Bundle dir:** `docs/demo/bundle/`

This is the final judge-facing recording plan. Record the product, evidence, and live listing—not setup work.
Use a clean browser profile and a large editor font. **Never** show `.env`, payment signatures, receipt capabilities, or API keys.

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
| **0–7s** | Hook | https://shomer-ui.pages.dev — hold on the hero | “Is this the deployment you approved? Shomer is the X Layer ship gate for founders and agents.” |
| **7–18s** | The comparison | Landing checks or app policy view | “It compares live ownership, Safe, upgrade authority, timelock, and implementation with the policy you locked.” |
| **18–30s** | Policy Matched | `matched.json`: verdict, block, owner evidence | “The correct approved owner at pinned block 12345 returns **Policy Matched**—with evidence, never a safety claim.” |
| **30–42s** | Blocked | `blocked.json`: expected and actual owner | “Change only the approved owner and the same deployment is **Blocked**. An agent must not ship or trust it.” |
| **42–53s** | Review Required | `review.json`: undeclared pauser role | “An undeclared privilege becomes **Review Required**. Shomer never turns missing policy into a green check.” |
| **53–68s** | Paid proof | `paid-artifact-match.sanitized.json`: artifact match, privilege map, brief ID | “Deep Verification adds the privilege map, reviewed runtime-hash match, and a human-ready Auditor Brief.” |
| **68–80s** | Payment + recovery | `payment-proof.sanitized.json`: transaction, recovered report | “The paid call settles 0.05 USDC on X Layer. If the response is lost, the persisted report is recovered without charging twice.” |
| **80–88s** | Listed product | https://www.okx.ai/agents/6117 — Shomer listing | “Shomer is live as OKX.AI ASP **#6117**: free verification and paid Deep Verification.” |

End on the listed agent page for at least two seconds. Do not end on code or a terminal.

---

## Files to open while recording

| File | Use |
| --- | --- |
| `https://shomer-ui.pages.dev` | Opening + brand |
| `matched.json` | Green path |
| `blocked.json` | Wrong owner |
| `review.json` | Undeclared privilege |
| `matched.brief.md` | Auditor brief scroll (optional cutaway) |
| `paid-artifact-match.sanitized.json` | Paid climax |
| `payment-proof.sanitized.json` | 402 + sanitized receipt |
| OKX agent page | End card |

---

## Golden path summary

| Path | Verdict | Brief ID | Artifact |
| --- | --- | --- | --- |
| matched | policy_matched | shomer-196-12345-8c5c1ca6ee9c | matched |
| blocked | blocked | shomer-196-12345-2ba100e2d244 | — |
| review | review_required | shomer-196-12345-ae7af63611f6 | — |

All three free-style reports use the **same pinned fixture block** (12345) so re-cuts stay consistent.

---

## Rehearsal checklist (clean browser / terminal)

- [ ] Only public URLs (Pages + Worker) — no localhost
- [ ] Browser at 100%; editor/JSON font at least 18 px
- [ ] Hide bookmarks, personal tabs, notifications, wallet balances, and email
- [ ] Warm one free verify before the take
- [ ] Bundle files pre-opened in tabs
- [ ] No `.env`, wrangler secrets, or payment authorization headers visible
- [ ] Keep each evidence shot focused on 2–4 fields; do not scroll walls of JSON
- [ ] Voice is louder than music; no music is also acceptable
- [ ] End freeze on the approved ASP #6117 listing

## What to highlight in each evidence file

| File | Keep visible |
| --- | --- |
| `matched.json` | `verdict`, `blockNumber`, owner check, evidence source |
| `blocked.json` | expected owner, actual owner, exact remediation |
| `review.json` | undeclared role and why human review is required |
| `paid-artifact-match.sanitized.json` | `artifactComparison.status`, runtime hash, privilege map, brief ID |
| `payment-proof.sanitized.json` | public transaction hash and recovered-report result |

Blur nothing in post-production. If a field is sensitive, do not capture it in the first place.

## Optional live curls (not required if using bundle)

```bash
# Free verify (warm)
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify \
  -H 'Content-Type: application/json' \
  -d '{"network":"mainnet","contractAddress":"0xcA11bde05977b3631167028862bE2a173976CA11"}' \
  | jq '{verdict,coverage,blockNumber,policyHash}'

# Paid challenge only (402 — safe)
curl -i -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid \
  -H 'Content-Type: application/json' \
  -d '{"network":"mainnet","contractAddress":"0xcA11bde05977b3631167028862bE2a173976CA11"}'
```

---

## Submit

1. Watch once with sound and once muted; the captions and visible fields should still tell the story.
2. Confirm runtime is below 90 seconds and the export is 1080p.
3. Attach the video to the submission/X post and link https://shomer-ui.pages.dev, https://shomer-agent-api.mixed-mouse.workers.dev/api/agent, and https://www.okx.ai/agents/6117.
4. Submit before **July 27**.

Product boundaries: [FREE-VS-PAID.md](../../FREE-VS-PAID.md) · Agent integration: [AGENT-SKILL.md](../../AGENT-SKILL.md)
