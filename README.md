# Shomer

**X Layer Ship Gate — deployment policy verification for founders and agents.**

> Shomer verifies that your real deployment matches the security policy you approved.

It is **not** an AI smart-contract auditor. It does not claim contracts are safe. It does not replace a human audit.

## MVP scope

- **EVM only** — X Layer mainnet (`196`) and testnet (`1952`)
- **Contract-address first** — paste a live address, declare a Launch Manifest, run checks
- **Real onchain reads** via [viem](https://viem.sh) against public X Layer RPCs
- **LocalStorage only** for the manifest and last scan (no auth, no database)
- **Verdicts:** Blocked · Review Required · Policy Matched  
  Never “safe” or “audited.”

## Deterministic checks (v1)

| Check | Evidence |
| --- | --- |
| Chain / deployer | `eth_chainId` + OKLink creation-info via **server proxy** (`OKLINK_API_KEY`) or public fallback |
| Owner / Safe | `owner()`, Safe `getThreshold` / `getOwners` |
| Upgrade authority | EIP-1967 admin / implementation slots |
| Timelock | `getMinDelay()` on owner/admin candidates |
| Implementation / code hash | EIP-1967 + `keccak256(bytecode)` |
| Initializer sealed | `initialized()` / OZ storage when readable |
| Address sanity | zero/dead/no-code/chain mismatch |
| Verification status | Sourcify API (unknown/unverified → skip/review) |
| Optional getters | `feeRecipient`, `treasury`, `oracle`, `router` when present |

If a pattern cannot be read reliably, the check is **Evidence missing** (declared/required) or **Out of scope** (undeclared/optional/N/A), or **Review Required** with the gap stated. Results are never fabricated. Evidence missing blocks **Policy Matched**.


## Free vs Paid

See [docs/FREE-VS-PAID.md](./docs/FREE-VS-PAID.md).

| Tier | What you get |
| --- | --- |
| **Free** | packs, read, draft, verify, **ship-gate** — verdict + evidence + policyHash |
| **Paid** | **Deep Verification** — privilegeMap + artifactComparison + auditorBrief (x402 on X Layer) |

## Agent quickstart (OKX.AI ASP #6117)

Listed on **OKX.AI**. Free A2MCP (always-on Worker):

```bash
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify \
  -H 'Content-Type: application/json' \
  -d '{"network":"mainnet","contractAddress":"0xcA11bde05977b3631167028862bE2a173976CA11","policy":{"upgradeable":false}}'
```

| Endpoint | URL |
| --- | --- |
| Catalog | `GET https://shomer-agent-api.mixed-mouse.workers.dev/api/agent` |
| Free verify | `POST …/api/agent/verify` |
| Paid Deep Verification (x402, X Layer USDC) | `POST …/api/agent/verify/paid` |

Verdicts: **Blocked** · **Review Required** · **Policy Matched**. Not an audit. Never “safe.”

## Develop

```bash
npm install
cp .env.example .env   # optional: set OKLINK_API_KEY for authenticated deployer
npm run dev
```

Open the URL Vite prints (default http://localhost:4173).

**OKLink deployer:** put `OKLINK_API_KEY` in `.env` (never `VITE_*`).  
Vite serves `GET /api/oklink/creation-info` on dev/preview; the key stays on the server.

**A2MCP agent APIs (OKX.AI ASP):**

| Endpoint | Tier |
| --- | --- |
| `GET /api/agent` | Catalog |
| `POST /api/agent/verify` | Free |
| `POST /api/agent/verify/paid` | x402 paid Deep Verification on **X Layer** (`X402_PAY_TO`) |

Paid calls add a bounded multi-contract privilege map, optional reviewed
runtime artifact/code-hash comparison, and an auditor-ready evidence brief in
JSON and Markdown. Existing free request bodies remain valid.

**Cloudflare Workers (recommended, free always-on):**

```bash
npx wrangler login
npm run worker:deploy
# secrets: npx wrangler secret put OKLINK_API_KEY --config workers/agent-api/wrangler.toml
```

See [docs/ASP.md](./docs/ASP.md).

```bash
npm run build
npm run preview   # also mounts the OKLink proxy
```

## Founder loop

1. **Read live state** — real X Layer RPC; shows privilege map. No policy verdict yet.
2. **Fill draft from live** (optional) — seeds an *editable draft* only. Never auto-approves. Never means Policy Matched.
3. **Edit draft** — fields show **IMPORTED** vs **FOUNDER** provenance.
4. **Approve manifest vN** — freezes an immutable snapshot. Required before verify.
5. **Verify vs approved** — compares live state only to the approved version.
6. Export **Auditor Brief** for a human reviewer.

## Disclaimer

Shomer compares declared policy to observable deployment facts.  
A **Policy Matched** verdict means evaluated hard policies agreed with onchain state at a given block — not that the protocol is safe or audited.
