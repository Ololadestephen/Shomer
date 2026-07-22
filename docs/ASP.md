# Shomer as OKX.AI ASP (A2MCP)

Shomer exposes **free** and **paid** agent endpoints for the OKX.AI marketplace.

## Recommended host: Cloudflare Workers (free, always-on)

No laptop or tunnel required after deploy.

```bash
# one-time: log in
npx wrangler login

# secrets (server-only)
npx wrangler secret put OKLINK_API_KEY --config workers/agent-api/wrangler.toml
npx wrangler secret put X402_PAY_TO --config workers/agent-api/wrangler.toml   # paid tier
# optional:
# npx wrangler secret put X402_FACILITATOR_URL --config workers/agent-api/wrangler.toml

# deploy
npm run worker:deploy
```

Wrangler prints a URL like:

`https://shomer-agent-api.<your-subdomain>.workers.dev`

Use that for ASP registration:

| Service | URL |
| --- | --- |
| Free | `https://shomer-agent-api.<sub>.workers.dev/api/agent/verify` |
| Paid | `https://shomer-agent-api.<sub>.workers.dev/api/agent/verify/paid` |
| Paid receipt recovery | `https://shomer-agent-api.<sub>.workers.dev/api/agent/receipts/:receiptId` |
| Catalog | `https://shomer-agent-api.<sub>.workers.dev/api/agent` |

Local Worker preview (still uses Cloudflare, no tunnel to Vite):

```bash
npm run worker:dev
```

### Can I use the Worker for the hackathon?

**Yes.** After `worker:deploy`, point OKX.AI A2MCP at the `workers.dev` HTTPS URLs. You do **not** need Vercel or cloudflared for the agent API (keep Vite only for the human UI if you want).

---

## Endpoints (Vite dev / preview — optional)

Base: `http://localhost:4173` or a tunnel

| Method | Path | Tier |
| --- | --- | --- |
| `GET` | `/api/agent` | Catalog |
| `POST` | `/api/agent/verify` | **Free** — result immediately |
| `POST` | `/api/agent/verify/paid` | **Paid** — x402 Deep Verification bundle |

## Free body

```json
{
  "network": "mainnet",
  "contractAddress": "0xcA11bde05977b3631167028862bE2a173976CA11",
  "policy": {
    "upgradeable": false,
    "owner": ""
  },
  "projectName": "Smoke"
}
```

`policy` is optional. Blank / omitted fields stay **out of scope**.


## Agent workflow tools

| Tool | Method | Path |
| --- | --- | --- |
| list_policy_packs | GET | `/api/agent/packs` |
| read_deployment_state | POST | `/api/agent/read` |
| create_policy_draft | POST | `/api/agent/draft` |
| ship_gate (free composite) | POST | `/api/agent/ship-gate` |
| verify_deployment | POST | `/api/agent/verify` |
| verify_deployment_paid | POST | `/api/agent/verify/paid` |

Draft endpoint always returns `status: "draft_only"` and `approved: null`.

## Agent request extras (product)

```json
{
  "network": "mainnet",
  "contractAddress": "0x…",
  "policyPreset": "non_upgradeable",
  "policy": { "owner": "0x…" },
  "blockNumber": 65500000,
  "options": {
    "undeclaredObserved": "out_of_scope",
    "includeEvidence": true
  }
}
```

| Field | Meaning |
| --- | --- |
| `policyPreset` | `non_upgradeable` · `ownable` · `safe_owned_proxy` · `immutable_token` (explicit `policy` wins) |
| `blockNumber` | Pin all RPC reads to this block |
| `options.undeclaredObserved` | `review` (default) or `out_of_scope` — never hides mismatches |
| `options.includeEvidence` | default `true` — per-check evidence in JSON |

Presets: see `src/lib/policy/presets.ts`. Engine fixtures: `npm run test:engine`.

## Example free call

```bash
curl -s -X POST http://localhost:4173/api/agent/verify \
  -H 'Content-Type: application/json' \
  -d '{"network":"mainnet","contractAddress":"0xcA11bde05977b3631167028862bE2a173976CA11"}' | jq .
```

## Paid (x402)

The paid response includes `deepVerification` with:

- `privilegeMap` — related owner, Safe signer, proxy admin, upgrader,
  implementation, timelock, minter, treasury, fee, oracle, router, factory,
  pool, and common AccessControl relationships. Related-address code probes are
  block-pinned and capped to prevent unbounded fan-out.
- `artifactComparison` — deterministic root runtime and proxy implementation
  address/code-hash checks against an optional reviewed artifact.
- `auditorBrief` — report ID, content digest, policy snapshot, blockers/review
  items, exact remediation, evidence index, limitations, and downloadable
  Markdown content.

The original body still works. Optional paid inputs:

```json
{
  "network": "mainnet",
  "contractAddress": "0x…",
  "policy": {},
  "projectName": "Protocol launch",
  "reviewedArtifact": {
    "name": "Reviewed implementation",
    "reviewedCommit": "abc123",
    "implementationAddress": "0x…",
    "implementationCodeHash": "0x…",
    "deployedBytecode": { "object": "0x…" }
  },
  "relatedContracts": [
    { "address": "0x…", "label": "staking module" }
  ]
}
```

`deployedBytecode` accepts a Foundry-compatible runtime bytecode string or
`{ "object": "0x…" }`. When `implementationAddress` is supplied, its computed
hash is compared to the live implementation; otherwise it is compared to the
root runtime code hash. Explicit hashes must be 32-byte `0x` values.

1. Set in `.env` (settlement on **X Layer**, not Base):
   ```bash
   X402_PAY_TO=0xYourReceivingWallet
   X402_NETWORK=xlayer          # → eip155:196
   # X402_NETWORK=xlayer-testnet  # → eip155:1952
   X402_PRICE_USD=0.01
   X402_ASSET=0x74b7f16337b8972027f6196a17a631ac6de26d22
   X402_ASSET_NAME=USD Coin
   X402_ASSET_VERSION=2
   X402_FACILITATOR_URL=https://web3.okx.com/api/v6/pay/x402
   OKX_API_KEY=…
   OKX_SECRET_KEY=…
   OKX_PASSPHRASE=…
   ```
2. Call without payment → **HTTP 402** + `PAYMENT-REQUIRED` header (network `eip155:196`).
3. Client confirms payment through the **OKX Agent Payments Protocol**, then retries with the returned authorization header (USDC on X Layer).
4. Local testing: `X402_DEV_BYPASS=1` accepts any non-empty payment header (**never in production**).

The HTTP 402 metadata describes `network`, `contractAddress`, `policy`,
`projectName`, artifact fields, and related contracts as JSON-body parameters
(`carrier: "body"`). An A2MCP/x402 client should replay the original JSON body
unchanged; no custom wrapper or query conversion is required.

Scalar-only A2MCP clients can send `reviewedRuntimeCodeHash`,
`reviewedImplementationAddress`, `reviewedImplementationCodeHash`,
`reviewedArtifactName`, and `reviewedCommit` as flat JSON-body aliases. This
avoids serializing a nested artifact object through a string-only parameter UI.

Successful paid responses include `payment.receiptId`,
`payment.transactionHash`, and `payment.retrievalUrl`. The Worker durably stores
the generated report before settlement and the final transaction/report before
returning it. After a network timeout, retry the identical paid request with the
same authorization or GET the returned receipt URL. Reusing one authorization
for a different request body returns `409 payment_replay_mismatch`.

Production fails closed when facilitator configuration or its authenticated OKX
Payment API credentials are missing, unavailable, or do not explicitly confirm
verification and settlement. A structurally plausible header never unlocks Deep
Verification.

```bash
# Expect 402 without payment
curl -i -X POST http://localhost:4173/api/agent/verify/paid \
  -H 'Content-Type: application/json' \
  -d '{"network":"mainnet","contractAddress":"0xcA11bde05977b3631167028862bE2a173976CA11"}'
```

Fixtures:

```bash
npm run test:paid
npm run test:x402
npm run test:recovery
npm run demo:golden
```

## OKX.AI registration (A2MCP free + paid)

Use Onchain OS agent prompts (see [okx.ai/tutorial/asp](https://www.okx.ai/tutorial/asp)):

```text
Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS
```

Suggested services:

1. **shomer-verify-free** → `POST {PUBLIC_URL}/api/agent/verify` (free)  
2. **shomer-verify-paid** → `POST {PUBLIC_URL}/api/agent/verify/paid` (x402)

Listing copy:

> Shomer verifies that an X Layer deployment matches a declared launch policy (owner, Safe, upgrade, timelock, implementation). Returns Blocked / Review Required / Policy Matched with evidence. Not an audit. Never “safe.”

Then:

```text
Help me list my ASP on OKX.AI using Onchain OS
```

## Public host

Marketplace agents need a **public HTTPS** URL. Tunnel for demos:

```bash
npm run dev
# e.g. cloudflared tunnel --url http://localhost:4173
```

Keep `OKLINK_API_KEY` and `X402_*` on the server only (no `VITE_` prefix).
