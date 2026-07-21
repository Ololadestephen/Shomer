# Shomer — OKX.AI A2MCP listing copy

**Base URL (Mixed Mouse):**  
`https://shomer-agent-api.mixed-mouse.workers.dev`

**Avatar (required for ASP upload):**  
`docs/shomer-asp-avatar.png`  
**OKX review specs (must match or listing is rejected):**
- **440×440 px** PNG (exact)
- **Square corners only** — no rounded app-icon mask, no gray/white margins
- Full-bleed dark green + shield/keyhole, sharp / high-res
- Previous reject: 512×512 with rounded corners (`docs/shomer-asp-avatar-old-512-rounded.png` kept as backup)
- Optional 2× master: `docs/shomer-asp-avatar-880.png` (downscale to 440 if re-exporting)

Use this when the Onchain OS agent asks for name, description, services, and endpoints.

---

## Identity

| Field | Value |
| --- | --- |
| **ASP / Agent name** | `Shomer` |
| **Short tagline** | X Layer Ship Gate — policy vs live for founders and agents |
| **Category fit** | Software Utility / infrastructure (policy vs live chain) |

---

## Description (short — for marketplace card)

Shomer is the **X Layer Ship Gate**: agents and founders verify that a live deployment matches the launch policy you approved (owner, Safe, upgrade, timelock, implementation). **Free:** packs, read, draft, verify, ship-gate. **Paid Deep Verification:** privilege map, reviewed artifact/code-hash, auditor brief (x402 USDC on X Layer). Not an audit. Never “safe.”

---

## Description (long — for registration / X post)

**Shomer** is a deployment policy verifier built for **X Layer** (chain ID 196).

Founders and agents pass a contract address and an optional policy snapshot. Shomer:

1. Reads live state via X Layer RPC (and optional OKLink creation-info for deployer).
2. Runs a **deterministic** policy engine (no LLM guessing).
3. Returns a structured verdict, coverage, and per-check evidence.

**Verdicts:** Blocked · Review Required · Policy Matched  
**Skip honesty:** undeclared fields = out of scope; declared but unreadable = evidence missing (never treated as a pass).

Human UI: local/browser founder loop (draft → approve vN → re-verify → Auditor Brief).  
Agent interface: **A2MCP** free + paid HTTP APIs below.

This service does **not** audit Solidity, does **not** replace human review, and does **not** claim a contract is safe.

---

## Services to register (A2MCP)

### 1) Free — `shomer-verify` (primary for hackathon)

| Field | Value |
| --- | --- |
| **Service name** | `shomer-verify` |
| **Type** | A2MCP |
| **Pricing** | **Free** |
| **Method** | `POST` |
| **Endpoint** | `https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify` |
| **Content-Type** | `application/json` |

**Service description:**  
Free X Layer policy verification. Body: `network` (`mainnet`\|`testnet`), `contractAddress`, optional `policy` (partial launch manifest), optional `projectName`. Returns verdict, coverage, checks, facts summary, disclaimer.

**Example body:**

```json
{
  "network": "mainnet",
  "contractAddress": "0xcA11bde05977b3631167028862bE2a173976CA11",
  "policy": {
    "upgradeable": false
  },
  "projectName": "Demo"
}
```

---

### 2) Paid — `shomer-verify-paid` (x402, X Layer USDC)

| Field | Value |
| --- | --- |
| **Service name** | `shomer-verify-paid` |
| **Type** | A2MCP |
| **Pricing** | **Paid** — `$0.01` USDC per call (x402) |
| **Settlement network** | X Layer mainnet (`eip155:196`) — **not Base** |
| **Method** | `POST` |
| **Endpoint** | `https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid` |
| **Content-Type** | `application/json` |
| **Payment** | x402: without payment → HTTP **402** + `PAYMENT-REQUIRED`; retry with `PAYMENT-SIGNATURE` / `X-PAYMENT` |

**Service description:**  
Deep X Layer deployment verification with a bounded multi-contract privilege
map, optional reviewed runtime artifact/code-hash comparison, and an
auditor-ready JSON + Markdown evidence brief. Pay-per-call via x402 on X Layer.

**The same JSON body as free remains valid.** Paid callers may also provide
`reviewedArtifact` / `deploymentArtifact` and `relatedContracts`.

---

### 3) Optional catalog

| Field | Value |
| --- | --- |
| **Service name** | `shomer-catalog` |
| **Type** | A2MCP |
| **Pricing** | Free |
| **Method** | `GET` |
| **Endpoint** | `https://shomer-agent-api.mixed-mouse.workers.dev/api/agent` |

---

## Prompts to paste into your Onchain OS agent

### Install / wallet (if not done)

```text
npx skills add okx/onchainos-skills --yes -g
```

(New session, then:)

```text
Log in to Agentic Wallet on Onchain OS with my email
```

### Register A2MCP

```text
Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS.

Name: Shomer
Tagline: X Layer deployment policy verification for founders and agents

Description:
Shomer verifies that a real X Layer deployment matches the launch policy you approved. It reads live onchain state (owner, Safe, upgrade authority, timelock, implementation) and returns Blocked, Review Required, or Policy Matched with evidence. Not an audit. Never claims "safe." Built for X Layer (chain 196).

Services:
1) shomer-verify — FREE A2MCP
   POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify
   JSON body: { "network": "mainnet"|"testnet", "contractAddress": "0x…", "policy": {optional fields}, "projectName": "optional" }
   Returns verdict, coverage, check results, facts, disclaimer.

2) shomer-verify-paid — PAID A2MCP (x402, USDC on X Layer eip155:196, $0.01)
   POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid
   Same body as free. Without payment returns HTTP 402 + PAYMENT-REQUIRED. Retry with payment headers.

Default pricing: free service free; paid $0.01 USDC on X Layer via x402.
```

### List on marketplace

```text
Help me list my ASP on OKX.AI using Onchain OS.

ASP name: Shomer
Public free endpoint: https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify
Public paid endpoint: https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid
Catalog: https://shomer-agent-api.mixed-mouse.workers.dev/api/agent
```

---

## X post draft (#OKXAI, ≤90s demo)

```text
Shipping Shomer for #OKXAI Genesis — deployment policy verification on @XLayerOfficial

Shomer checks that live X Layer state matches the policy you approved:
owner · Safe · upgrade · timelock · impl · sanity

Verdicts: Blocked | Review Required | Policy Matched
Never "safe." Never "audited." Real RPC, deterministic checks.

A2MCP free + paid (x402 on X Layer):
https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify

[attach ≤90s screen recording]
```

---

## Demo script (≤90 seconds)

1. Open human UI (optional) or curl free API.  
2. Show `POST /api/agent/verify` with Multicall3 / your contract → verdict JSON.  
3. One line: “agents call this; founders use Live → Policy → Approve → Results.”  
4. End on disclaimer: evidence, not audit.

---

## Google form checklist

- [ ] ASP name: Shomer  
- [ ] Agent ID (after register/list)  
- [ ] Free endpoint URL  
- [ ] Paid endpoint URL (if listed)  
- [ ] Link to X post with #OKXAI  
- [ ] Category: Software Utility (or Best Product if pitching product polish)  
- [ ] Demo link / video ≤90s  
