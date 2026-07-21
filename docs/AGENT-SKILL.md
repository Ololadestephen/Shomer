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

```bash
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/ship-gate \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0x…",
    "packId": "simple_ownable",
    "fillFromLive": true,
    "options": { "undeclaredObserved": "out_of_scope" }
  }'
```

Inspect: `shipGate.allowed`, `shipGate.recommendation`, `verdict`, `policyHash`, `results[].evidence`.

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

Then settle x402 on **X Layer USDC** and retry with `PAYMENT-SIGNATURE` / `X-PAYMENT`.

---

## Hard rules for agents

- Never convert `review_required` or skips into “safe.”
- Never treat draft as approved.
- Prefer free ship-gate for automation; escalate to paid deep when a human needs a privilege/artifact package.
- X Layer only (mainnet 196 / testnet 1952).
