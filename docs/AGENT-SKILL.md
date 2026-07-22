# Shomer Agent Skill — X Layer Ship Gate (ASP #6117)

Use this when another agent must check whether a **live X Layer deployment** matches a declared launch policy before shipping, integrating, or trusting it.

**Never claim the contract is safe or audited.** Shomer only returns **Blocked / Review Required / Policy Matched** with evidence.

## Free vs Paid (always choose correctly)

| Need | Tier | Endpoint |
| --- | --- | --- |
| Verdict + evidence, packs, draft, ship gate | **FREE** | below |
| Privilege map + reviewed bytecode/impl hash + auditor brief (Markdown) | **PAID** | `POST …/verify/paid` + x402 USDC on **eip155:196** (~$0.01) |

**Base:** `https://shomer-agent-api.mixed-mouse.workers.dev`

### Free tools

```text
GET  /api/agent              → catalog
GET  /api/agent/packs        → list_policy_packs
POST /api/agent/read         → read_deployment_state (facts only)
POST /api/agent/draft        → create_policy_draft (draft_only, never approved)
POST /api/agent/verify       → verify_deployment
POST /api/agent/ship-gate    → composite: optional pack draft + free verify + shipGate.allowed
```

### Paid tool

```text
POST /api/agent/verify/paid  → Deep Verification (x402)
  body may include reviewedArtifact, relatedContracts
  response.deepVerification = { privilegeMap, artifactComparison, auditorBrief }
GET  /api/agent/receipts/:receiptId → recover a settled paid report
```

---

## Recommended free workflow

1. `GET /api/agent/packs` — pick pack (`simple_ownable`, `safe_governed`, `uups_proxy`, `transparent_proxy`, `erc20_launch`).
2. `POST /api/agent/read` — observe live facts (optional if using ship-gate with fillFromLive).
3. `POST /api/agent/draft` with `packId` + `fillFromLive: true` → **draft_only** (founder must Approve in UI if human loop).
4. `POST /api/agent/verify` with final **policy** snapshot (or use ship-gate).
5. If `verdict === "blocked"` → **do not ship / do not trust**.
6. If review_required → surface findings; do not invent Policy Matched.

### One-shot free ship-gate

**Integrity rules (important):**

- `fillFromLive` only builds a **draft suggestion** for founders — it is **never** the policy used for the verdict.
- Verification uses **pack defaults + your explicit `policy` fields only**.
- `shipGate.allowed === true` only when `verdict === "policy_matched"` **and** you supplied an **explicit approved policy** (`approvedPolicy: true` with real fields like `owner` / Safe / impl — not pack defaults alone).
- **Review Required ⇒ allowed false.**
- One chain read per request (`chainReads: 1`).

```bash
# Clear to ship only with a locked/approved policy body
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/ship-gate \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0x…",
    "approvedPolicy": true,
    "policy": {
      "upgradeable": false,
      "owner": "0x…approved-owner…"
    }
  }'
```

```bash
# Optional: also return a live-filled draft for humans (not used for the verdict)
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/ship-gate \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0x…",
    "packId": "simple_ownable",
    "fillFromLive": true,
    "approvedPolicy": true,
    "policy": { "upgradeable": false, "owner": "0x…approved-owner…" }
  }'
```

Inspect: `shipGate.allowed`, `shipGate.explicitApprovedPolicy`, `shipGate.recommendation`, `verificationPolicy`, `chainReads`, `policyHash`, `results[].evidence`.

---

## Paid Deep Verification (when you need the evidence package)

Use when the user/agent needs:

- multi-contract **privilege map**
- **reviewed artifact** vs live runtime/impl hash (Foundry bytecode)
- **auditor brief** (JSON + Markdown + content digest)

```bash
# Expect 402 without payment headers
curl -i -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0x…",
    "policy": { "upgradeable": true, "owner": "0x…" },
    "reviewedArtifact": {
      "name": "Reviewed impl",
      "implementationAddress": "0x…",
      "implementationCodeHash": "0x…"
    }
  }'
```

Then confirm the X Layer USDC charge through the **OKX Agent Payments Protocol** and retry with the authorization header it returns. Never replay a charge without the required user confirmation.

The 402 discovery metadata declares every business parameter with
`carrier: "body"`. Payment clients should replay the **same JSON object** as the
POST body; do not wrap it in `body`, `input`, `params`, or query parameters.

For A2MCP clients that only accept scalar known parameters, reviewed-artifact
comparison also supports these flat body aliases:

- `reviewedArtifactName`
- `reviewedCommit`
- `reviewedRuntimeCodeHash`
- `reviewedImplementationAddress`
- `reviewedImplementationCodeHash`

They map to the equivalent properties inside `reviewedArtifact`; direct API
callers can continue sending the nested object.

On success, persist these fields from `payment`:

- `receiptId`
- `transactionHash`
- `retrievalUrl`

If the client times out after paying, retry the identical POST with the same
payment authorization or GET the capability-style `retrievalUrl`. Shomer stores
the generated report before settlement and stores the settlement transaction
before replying. The payment authorization itself is never stored.

---

## Hard rules for agents

- Never convert `review_required` or skips into “safe.”
- Never treat draft as approved.
- Prefer free ship-gate for automation; escalate to paid deep when a human needs a privilege/artifact package.
- X Layer only (mainnet 196 / testnet 1952).
