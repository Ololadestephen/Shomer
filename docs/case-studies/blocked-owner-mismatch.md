# Case study: Blocked on owner mismatch (X Layer mainnet)

**Purpose:** Prove Shomer’s Software Utility — measurable time saved and honest **Blocked** when policy ≠ live chain.

**ASP:** #6117 · Ship Gate

## Scenario

| Item | Value |
| --- | --- |
| Network | X Layer mainnet (196) |
| Contract | `0xbff976f8874814e6f2ee98d559826812ff26597f` (standard Ownable fixture) |
| Real owner (live) | Read via free `POST /api/agent/read` or verify facts |
| Wrong policy owner | `0x5aFe00000000000000000000000000000000d021` |

## Free path (ship gate / verify)

```bash
# 1) Read live (facts only)
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/read \
  -H 'Content-Type: application/json' \
  -d '{"network":"mainnet","contractAddress":"0xbff976f8874814e6f2ee98d559826812ff26597f"}' \
  | jq '{owner: .facts.owner, isProxy: .facts.isProxy, codeHash: .facts.codeHash}'

# 2) Verify with WRONG owner → expect verdict blocked
curl -sS -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0xbff976f8874814e6f2ee98d559826812ff26597f",
    "policy": {
      "upgradeable": false,
      "owner": "0x5aFe00000000000000000000000000000000d021"
    },
    "projectName": "Mismatch demo"
  }' | jq '{verdict, policyHash, owner: [.results[] | select(.checkKey=="owner_matches") | {status, expected, actual, evidence}]}'

# 3) Verify with live owner → expect matched or review (e.g. verification), not blocked on owner
```

**Time saved:** one structured call vs manual explorer + RPC + note-taking.

## Paid path (Deep Verification)

When you need a **privilege map**, **artifact comparison**, or **auditor brief**:

```bash
curl -i -X POST https://shomer-agent-api.mixed-mouse.workers.dev/api/agent/verify/paid \
  -H 'Content-Type: application/json' \
  -d '{
    "network": "mainnet",
    "contractAddress": "0xbff976f8874814e6f2ee98d559826812ff26597f",
    "policy": { "upgradeable": false, "owner": "0x…" },
    "reviewedArtifact": {
      "name": "Known runtime",
      "runtimeCodeHash": "0x…"
    }
  }'
```

Unpaid → **HTTP 402** x402 on eip155:196. After payment → `deepVerification` in body.

## Free vs Paid in this story

| | Free | Paid |
| --- | --- | --- |
| Catch wrong owner | **Yes (Blocked)** | Yes + deeper package |
| Evidence per check | Yes | Yes |
| Privilege map | No | **Yes** |
| Reviewed artifact / Foundry hash | Via policy fields | **First-class deep bundle** |
| Auditor Markdown brief | No (UI brief for founders) | **Yes in API** |

## Demo talking points

1. “Ship gate: agents must not treat this deploy as approved.”  
2. Show **Blocked** — product says no.  
3. “Paid Deep Verification is for teams that need the privilege map and artifact receipt — not a different truth engine.”
