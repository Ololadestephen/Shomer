# Shomer Free vs Paid

**Positioning:** X Layer **Ship Gate** — policy vs live chain. Not an audit. Never “safe.”

## Free (primary)

| Capability | Endpoint |
| --- | --- |
| Catalog | `GET /api/agent` |
| Policy packs | `GET /api/agent/packs` |
| Read live facts | `POST /api/agent/read` |
| Create draft (never approved) | `POST /api/agent/draft` |
| Verify | `POST /api/agent/verify` |
| Ship gate (draft+verify composite) | `POST /api/agent/ship-gate` |

**Returns:** verdict, coverage, per-check evidence, facts, `policyHash`.

**Use for:** agents automating “can we treat this deploy as matching policy?”

## Paid (Deep Verification)

| Capability | Endpoint |
| --- | --- |
| Deep verify | `POST /api/agent/verify/paid` |
| Payment | x402 USDC on **X Layer** `eip155:196` · ~$0.01 |

**Same core policy engine as free**, plus:

- `deepVerification.privilegeMap` — bounded multi-contract privilege relationships + code probes  
- `deepVerification.artifactComparison` — reviewed runtime/impl hash vs live  
- `deepVerification.auditorBrief` — JSON + Markdown + content digest  

Optional body: `reviewedArtifact`, `relatedContracts`.

**Use for:** human-ready evidence packages, Foundry artifact confirmation, multi-address privilege context.

## What paid is NOT

- Not a second “safer” verdict language  
- Not an LLM audit  
- Not required for basic ship-gate automation  

## Founder UI

Local/public app: Live → Policy packs → Approve vN → Verify → Brief.  
Uses the **same free engine**. Paid is agent/API-oriented Deep Verification (UI can call paid later if desired).
