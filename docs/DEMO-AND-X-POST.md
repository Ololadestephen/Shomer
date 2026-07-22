# Shomer — 90s demo + X post (#OKXAI)

**ASP:** #6117  
**Free API:** `https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify`  
**Paid API:** `https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid`  
**Deadline context:** Google form + X post with #OKXAI (≤90s demo)

---

## Hyperframe demo (generative cut — ready for review)

**File:** [`docs/demo/shomer-okxai-demo-hyper.mp4`](demo/shomer-okxai-demo-hyper.mp4)  
**Also:** `docs/demo/shomer-okxai-demo-hyper-v2.mp4` (same cut)  
**Spec:** ~72s · 1280×720 · 24fps · no audio yet

**Beat sheet**

| Time (approx) | Beat |
| --- | --- |
| 0–3s | Title card — SHOMER / not an audit |
| 3–15s | Hyper open + “the question” + live-read mood |
| 15–27s | On-chain truth + policy seal |
| 27–36s | Founder loop + A2MCP agent card |
| 36–48s | Agent call mood + Evidence mid-card |
| 48–60s | Verdict orbs + seal the evidence |
| 60–72s | Logo breathe + ASP #6117 end card |

Creative full-generative trailer (not screen capture). Optional next: VO, real `curl` B-roll cut-in, or music bed.

---

## A) 90-second demo script (screen record)

**Goal:** Show *policy vs live X Layer*, agent-callable API, not an audit.

**Props:**
- Browser: Shomer UI (local or tunnel) optional
- Terminal: curl free verify
- Optional: Multicall3  
  `0xcA11bde05977b3631167028862bE2a173976CA11`

### Timeline

| Time | Visual | What you say |
| --- | --- | --- |
| **0–8s** | Logo / landing or terminal title | “Shomer verifies that a real X Layer deployment matches the policy you approved — not an audit, never ‘safe.’” |
| **8–25s** | Terminal: run free verify (see command below) | “Agents call this free A2MCP endpoint. Network, contract address, optional policy.” |
| **25–45s** | Scroll JSON: `verdict`, `coverage`, a few `results` | “Deterministic checks: owner, upgrade, timelock, implementation, sanity. Out of scope if undeclared — never fake a pass.” |
| **45–70s** | (Optional) App: Live → Policy → Approve → Results | “Founders use the same engine: read live, draft policy, approve vN, re-verify. Local only — no fake cloud claims.” |
| **70–85s** | Paid Deep Verification JSON | “Paid is Deep Verification: privilege map, reviewed artifact hash, auditor brief — x402 USDC on X Layer. Free ship-gate stays full verdict + evidence.” |
| **85–90s** | ASP #6117 + disclaimer | “Shomer ASP #6117 on OKX.AI — evidence for X Layer launches. Not audited. Not safe. Policy matched means policy matched.” |

### Curl for the recording

```bash
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0xcA11bde05977b3631167028862bE2a173976CA11",
    "policy": { "upgradeable": false },
    "projectName": "OKXAI demo"
  }' | jq '{verdict, coverage, blockNumber, results: [.results[] | {status, checkKey, skipReason}]}'
```

If `jq` isn’t available, drop the pipe and scroll the raw JSON.

### Recording tips
- 1080p, large terminal font  
- No long waits: run curl once before record so RPC is warm, then re-run on camera  
- Hard cut if RPC is slow  
- End freeze-frame on `verdict` + disclaimer  

---

## Free vs Paid (for X + form)

| | Free | Paid |
| --- | --- | --- |
| Job | Ship gate: policy vs live | Deep Verification package |
| Endpoints | verify, ship-gate, packs, read, draft | verify/paid |
| Payment | none | x402 USDC eip155:196 · $0.05 |
| Output | verdict + evidence + policyHash | + privilegeMap + artifactComparison + auditorBrief |

Before recording, run `npm run demo:golden`. It proves all three verdicts with
pinned evidence and an Auditor Brief. For the paid clip, show
`artifactComparison.status: "matched"` plus `payment.transactionHash`,
`payment.receiptId`, and `payment.retrievalUrl`; this demonstrates that both the
reviewed runtime and the purchase receipt are recoverable.

## B) X post (primary)

**Copy-paste:**

```text
Shomer is the X Layer Ship Gate — ASP #6117 for #OKXAI

Agents call us before they ship or trust a deployment:
live chain vs the policy you approved.

FREE: packs · read · draft · verify · ship-gate
→ Blocked / Review Required / Policy Matched
→ Evidence. Never "safe." Never "audited."

PAID Deep Verification (x402 USDC on X Layer):
privilege map · reviewed artifact/hash · auditor brief

Free: https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify
Ship-gate: …/api/agent/ship-gate
Paid: …/api/agent/verify/paid

#OKXAI #XLayer #BuildX #SoftwareUtility
```

Attach the ≤90s video.

---

## C) X post (shorter)

```text
#OKXAI ASP #6117 — Shomer

Is this X Layer deployment the one you approved?

Real RPC. Deterministic checks. Honest skips.
Free agent endpoint:
https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify

Not an audit. Evidence only.
```

---

## D) Google form notes (fill from this)

| Field | Suggestion |
| --- | --- |
| Project / ASP name | Shomer |
| ASP ID | 6117 |
| Description | Verifies live X Layer deployments against an approved launch policy. Returns Blocked / Review Required / Policy Matched with evidence. Not an audit. |
| Free endpoint | `https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify` |
| Paid endpoint | `https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid` |
| Category | Software Utility (and/or Best Product if allowed) |
| Demo | Link to X post / video ≤90s |
| X post | Your #OKXAI URL |

Form: https://forms.gle/mddEUagmDbyV37ws8  

---

## E) One-liner pitch (judges / form)

> Shomer verifies that your real X Layer deployment matches the security policy you approved — callable by agents (A2MCP) and usable by founders, without claiming “safe” or “audited.”
