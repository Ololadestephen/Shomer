# Shomer 90-second demo shot list

**ASP:** #6117  
**Public UI:** https://shomer-ui.pages.dev  
**Public API:** https://shomer-agent-api.mixed-mouse.workers.dev  
**Bundle dir:** `docs/demo/bundle/`  
**Generated:** 2026-07-22T14:35:30.621Z

Open files with a large font. Prefer `jq` / VS Code / Preview. **Never** show `.env`, payment signatures, or API keys.

---

## Timeline (≤90s)

| Time | Shot | On screen | Say / caption |
| --- | --- | --- | --- |
| **0–8s** | Landing | https://shomer-ui.pages.dev — Ship Gate hero | “Shomer is the X Layer Ship Gate — is this the deployment you approved?” |
| **8–22s** | Policy Matched | `matched.json` + scroll verdict/coverage | “Explicit approved policy, pinned block 12345. **Policy Matched** — evidence, not vibes.” |
| **22–38s** | Blocked | `blocked.json` — owner_matches blocked | “Wrong owner vs locked rules → **Blocked**. Agents must not ship.” |
| **38–52s** | Review Required | `review.json` — undeclared privilege | “Undeclared privilege → **Review Required**. We never invent a pass.” |
| **52–70s** | Paid artifact match | `paid-artifact-match.sanitized.json` + brief header | “Paid Deep Verification: privilege map + reviewed runtime hash **matched** + auditor brief.” |
| **70–80s** | Payment proof | `payment-proof.sanitized.json` — 402 + receipt shape | “x402 on X Layer USDC ~$0.01. Free alternative always linked. No secrets on screen.” |
| **80–88s** | Recover | `payment-proof.sanitized.json` — settledReceipt.recoveredReport | “The client lost its response; Shomer recovered the persisted report without a second payment.” |
| **88–90s** | End card | https://www.okx.ai/agents/6117 | “ASP **#6117** — free ship-gate, paid deep verification. Not audited. Not safe.” |

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
- [ ] Large terminal font; `jq '{verdict,coverage,policyHash,facts}'` for live curls if needed
- [ ] Warm one free verify before the take
- [ ] Bundle files pre-opened in tabs
- [ ] No `.env`, wrangler secrets, or payment authorization headers visible
- [ ] End freeze on ASP #6117

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

1. Record ≤90s from this shot list  
2. Google form + X post with #OKXAI before **July 27**  
3. Attach video; link free API + https://www.okx.ai/agents/6117  

See also: [DEMO-AND-X-POST.md](../DEMO-AND-X-POST.md) · [FREE-VS-PAID.md](../FREE-VS-PAID.md) · [AGENT-SKILL.md](../AGENT-SKILL.md)
