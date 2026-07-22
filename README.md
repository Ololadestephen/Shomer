# Shomer

**X Layer Ship Gate** — verify that a live deployment still matches the policy you approved.

[![OKX.AI ASP](https://img.shields.io/badge/OKX.AI-ASP%20%236117-0B1A12?style=flat-square)](https://www.okx.ai)
[![Chain](https://img.shields.io/badge/X%20Layer-196-2e7b54?style=flat-square)](https://www.okx.com/xlayer)
[![A2MCP](https://img.shields.io/badge/A2MCP-free%20%2B%20paid-c8e562?style=flat-square&labelColor=14281d)](#agent-api-a2mcp)

Agents and founders call Shomer **before they ship or trust** a contract:

> Is this the deployment we approved — owner, Safe, upgrades, timelock, implementation — **right now** on X Layer?

**Not an audit. Not “safe.”**  
Verdicts are only **Blocked** · **Review Required** · **Policy Matched**, with evidence. Empty rules are skipped; missing evidence never becomes a pass.

| | |
| --- | --- |
| **Live UI** | [shomer-ui.pages.dev](https://shomer-ui.pages.dev) |
| **Live API** | [shomer-agent-api.mixed-mouse.workers.dev](https://shomer-agent-api.mixed-mouse.workers.dev/api/agent) |
| **ASP** | #6117 on OKX.AI |

---

## Why it exists

Launch teams and agents still answer “is this the right deploy?” by hand: explorer tabs, RPC calls, Safe UI, proxy slots, sticky notes.

Shomer turns that into a **deterministic ship gate**:

1. Read **live** X Layer state (real RPC, no mocks).  
2. Hold a **locked rules** snapshot (what you approved).  
3. Compare and return a structured verdict + evidence agents can act on.

**Time saved:** one JSON call instead of a multi-tab scavenger hunt.  
**Honesty:** import from chain never auto-approves; blanks are out of scope, not green checks.

---

## Free vs Paid

Full detail: [docs/FREE-VS-PAID.md](./docs/FREE-VS-PAID.md)

| | **Free — Ship Gate** | **Paid — Deep Verification** |
| --- | --- | --- |
| **For** | Everyday agent automation | Evidence packages for humans / serious handoff |
| **Endpoints** | `packs` · `read` · `draft` · `verify` · `ship-gate` | `verify/paid` only |
| **Payment** | None | **OKX Agent Payments Protocol** · **USDC on X Layer** (`eip155:196`) · ~$0.01 |
| **You get** | Verdict, coverage, per-check evidence, facts, `policyHash` | Same core engine **plus** privilege map, reviewed artifact/code-hash compare, auditor brief (JSON + Markdown) |
| **Not** | Auto-approval or “safe” claims | A second truth engine or LLM audit |

Use **free** to decide “blocked or not.”  
Use **paid** when you need the privilege graph, Foundry-style artifact match, or a shareable brief.

---

## Quick start (founders)

```bash
npm install
cp .env.example .env   # optional: OKLINK_API_KEY, X402_* for paid locally
npm run dev
```

Open the URL Vite prints (default [http://localhost:4173](http://localhost:4173)).

**In plain English:**

| Step | What you do |
| --- | --- |
| **1 · On chain** | Paste an X Layer address → read what’s deployed now |
| **2 · Your rules** | Write what you approved (or copy from chain / use a template) |
| **3 · Lock in** | Freeze immutable rules `vN` — required before check |
| **4 · Check** | Compare live chain to locked rules → verdict + brief |

Public UI (static): [shomer-ui.pages.dev](https://shomer-ui.pages.dev)  
Redeploy UI: `npm run pages:deploy`

---

## Agent API (A2MCP)

**Base:** `https://shomer-agent-api.mixed-mouse.workers.dev`  
**Catalog:** `GET /api/agent`

### Free tools

| Tool | Method | Path |
| --- | --- | --- |
| Catalog | `GET` | `/api/agent` |
| List policy packs | `GET` | `/api/agent/packs` |
| Read deployment state | `POST` | `/api/agent/read` |
| Create policy draft | `POST` | `/api/agent/draft` |
| Verify | `POST` | `/api/agent/verify` |
| Ship gate (draft + verify) | `POST` | `/api/agent/ship-gate` |

```bash
# Free verify
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0xcA11bde05977b3631167028862bE2a173976CA11",
    "policy": { "upgradeable": false },
    "projectName": "demo"
  }'

# Free ship-gate (optional pack + fill from live + verify)
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/ship-gate \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0x…",
    "packId": "simple_ownable",
    "fillFromLive": true
  }'
```

Inspect `verdict`, `shipGate.allowed` / `shipGate.recommendation`, `policyHash`, and `results[].evidence`.

**Packs:** `simple_ownable` · `safe_governed` · `uups_proxy` · `transparent_proxy` · `erc20_launch`  
(draft only — never auto-approved)

### Paid Deep Verification

```bash
# Expect HTTP 402 without payment; confirm via OKX Agent Payments Protocol, then retry
curl -i -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0x…",
    "policy": { "upgradeable": true, "owner": "0x…" },
    "reviewedArtifact": {
      "name": "Reviewed implementation",
      "implementationAddress": "0x…",
      "implementationCodeHash": "0x…"
    }
  }'
```

Paid body may also include `relatedContracts` and Foundry-style `deployedBytecode`.  
Response includes `deepVerification`: `{ privilegeMap, artifactComparison, auditorBrief }`.

Agent playbook: [docs/AGENT-SKILL.md](./docs/AGENT-SKILL.md)

---

## What Shomer checks

Deterministic policy engine — no LLM guessing.

| Area | Evidence |
| --- | --- |
| Chain / deployer | `eth_chainId` + OKLink creation-info (server proxy when keyed) |
| Owner / Safe | `owner()`, Safe threshold & owners |
| Upgrade authority | EIP-1967 admin / implementation; UUPS signals |
| Timelock | `getMinDelay()` on candidates |
| Implementation / code hash | EIP-1967 + `keccak256(bytecode)` |
| Initializer | Common Initializable patterns when readable |
| Address sanity | Zero / dead / no-code flags |
| Source verification | Sourcify (unverified → review, not fake pass) |
| Optional integrations | fee, treasury, oracle, router, factory, pool, mint/supply, … |

**Skip honesty**

- **Out of scope** — rule not declared  
- **Evidence missing** — declared but unreadable → blocks **Policy Matched**  
- Results are never fabricated  

---

## Stack

| Layer | Tech |
| --- | --- |
| Founder UI | Vite + TypeScript, LocalStorage only |
| Chain reads | [viem](https://viem.sh) → X Layer RPC |
| Policy engine | Pure TS (`src/lib/policy`) |
| Always-on API | Cloudflare Worker (`workers/agent-api`) |
| Public UI host | Cloudflare Pages (`shomer-ui`) |
| Paid settlement | **OKX Agent Payments Protocol** v2 · USDC on **X Layer** (not Base) |

---

## Develop & deploy

```bash
npm install
cp .env.example .env
npm run dev          # UI + local agent/OKLink middleware
npm run build
npm run preview

# Always-on agent API
npx wrangler login
npm run worker:deploy
# secrets (server-only, never VITE_*):
#   npx wrangler secret put OKLINK_API_KEY --config workers/agent-api/wrangler.toml
#   npx wrangler secret put X402_PAY_TO --config workers/agent-api/wrangler.toml
#   npx wrangler secret put OKX_API_KEY --config workers/agent-api/wrangler.toml
#   npx wrangler secret put OKX_SECRET_KEY --config workers/agent-api/wrangler.toml
#   npx wrangler secret put OKX_PASSPHRASE --config workers/agent-api/wrangler.toml

# Public UI
npm run pages:deploy
```

See [`.env.example`](./.env.example) and [docs/ASP.md](./docs/ASP.md).

### Tests & smoke

```bash
npm run test:engine    # pure policy fixtures
npm run test:paid      # Deep Verification fixtures
npm run test:ship-gate # offline approval/verdict/one-read invariants
npm run test:x402      # offline payment challenge + fail-closed proof checks
npm run test:api       # malformed/oversized/bounded-input failure modes
npm run test:ci        # complete deterministic CI gate
npm run test:live:xlayer # opt-in live X Layer matrix (not CI)
npm run test:live:x402   # live free challenge; paid replay only with confirmed authorization
npm run case:blocked   # mainnet wrong-owner → Blocked
npm run smoke          # live RPC sample
npm run smoke:agent    # agent verify smoke
```

### Demo recording pack

```bash
npm run demo:bundle
```

Writes sanitized artifacts to [`docs/demo/bundle/`](./docs/demo/bundle/):

| File | Use on camera |
| --- | --- |
| `matched.json` / `matched.brief.md` | Policy Matched |
| `blocked.json` / `blocked.brief.md` | Wrong owner → Blocked |
| `review.json` / `review.brief.md` | Undeclared privilege → Review |
| `paid-artifact-match.sanitized.json` | Paid Deep Verification |
| `payment-proof.sanitized.json` | x402 402 + redacted receipt |
| `DEMO-SHOTLIST.md` | 90s timing |

Offline — no payment required. See [docs/TESTING.md](./docs/TESTING.md).

---

## Docs

| Doc | Contents |
| --- | --- |
| [FREE-VS-PAID.md](./docs/FREE-VS-PAID.md) | Tier split |
| [AGENT-SKILL.md](./docs/AGENT-SKILL.md) | Playbook for other agents |
| [ASP.md](./docs/ASP.md) | A2MCP / Workers / x402 |
| [ASP-LISTING.md](./docs/ASP-LISTING.md) | Marketplace listing copy |
| [DEMO-AND-X-POST.md](./docs/DEMO-AND-X-POST.md) | Demo script + #OKXAI post |
| [TESTING.md](./docs/TESTING.md) | Deterministic, live-chain, and paid test gates |
| [case-studies/blocked-owner-mismatch.md](./docs/case-studies/blocked-owner-mismatch.md) | Public Blocked example |

---

## Disclaimer

Shomer compares **declared policy** to **observable onchain facts** at a given block.

**Policy Matched** means the hard rules that could be evaluated agreed with live state — **not** that the protocol is safe, correct, or audited.  
**Blocked** means do not treat the deployment as matching what you approved.  
Shomer does not replace a human security review.

---

## License

Private / project default unless otherwise stated. Built for **OKX.AI Genesis** · ASP **#6117** · X Layer.
