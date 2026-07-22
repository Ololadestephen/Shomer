# Shomer verification test strategy

The default gate is deterministic and makes no RPC, explorer, facilitator, or
wallet calls:

```bash
npm run test:ci
```

The demo acceptance gate is also deterministic:

```bash
npm run demo:golden
```

It emits three paid-tier Auditor Briefs at one pinned fixture block:

- approved owner and reviewed runtime hash → **Policy Matched**;
- wrong owner/authority → **Blocked**;
- an owner-held but undeclared `PAUSER_ROLE` → **Review Required**.

It covers the policy engine, paid evidence bundle, ship-gate approval
invariants, x402 challenge handling, malformed requests, body limits, bounded
related-contract input, and upstream failure behavior.

## Phase map

| Phase | Gate | Network / funds |
| --- | --- | --- |
| 0 · Baseline | `npm run build`, existing fixtures | none |
| 1 · Verdict invariants | `npm run test:ship-gate` | none |
| 2 · Contract fixtures | injected `ObservedFacts`, one `readFacts` spy | none |
| 3 · Live X Layer | `npm run test:live:xlayer` | read-only RPC/explorer |
| 4 · Paid boundary | `npm run test:x402` | none |
| 4 · Receipt recovery | `npm run test:recovery` | none |
| 4 · Live challenge/replay | `npm run test:live:x402` | challenge is free; replay is opt-in |
| 5 · API failure modes | `npm run test:api` | none |

## Live X Layer matrix

```bash
npm run test:live:xlayer
```

This checks three real contracts, chain ID 196, bytecode presence, block
evidence, the no-policy verdict invariant, and elapsed time. Defaults:

- warn after 20 seconds per contract
- fail after 60 seconds per contract

Override with `LIVE_XLAYER_WARN_MS` and `LIVE_XLAYER_FAIL_MS`. It is excluded
from pull-request CI because public RPC and explorer availability are external.

## Paid endpoint

`npm run test:x402` is safe and offline. It proves that:

- the challenge is decodable and advertises X Layer;
- a fake payment-looking header cannot unlock the paid endpoint;
- a facilitator must explicitly report a proof as valid;
- a verified proof must also receive explicit settlement confirmation;
- missing facilitator configuration fails closed.

`npm run test:live:x402` calls the public paid endpoint without payment and
validates the free challenge. It does **not** sign or initiate a charge. A replay
only occurs when `X402_AUTHORIZATION_HEADER` is explicitly supplied after the
user has confirmed a payment through the **OKX Agent Payments Protocol**.

Never put payment authorization values or secrets in source control, logs, CI,
or shell history.

For the production artifact proof, first read the live `codeHash` (or proxy
`implementationCodeHash`) at a pinned block, then include that exact 32-byte
hash in `reviewedArtifact.runtimeCodeHash` (or
`reviewedArtifact.implementationCodeHash`) in the paid request. Acceptance
requires `deepVerification.artifactComparison.status === "matched"`, a pinned
Auditor Brief, and a persisted payment transaction/receipt.

### Production proof — 2026-07-22

- Contract: `0x5839244eab49314bccc0fa76e3a081cb1a461111`
- X Layer block: `65954437`
- Reviewed/live runtime hash:
  `0x3b19c4c11b459cd1e52f991bbbe78a64b869aeaa7f483f3ab0c12d84120eee64`
- Artifact comparison: `matched`
- Auditor Brief: `shomer-196-65954437-1ba7f41efd1f`
- Payment transaction:
  `0x665b7725059f61140ff2f39388feb7120e27691102c5cce05f7e7ea87a547987`
- Recovery proof: the report was retrieved from D1 after the client lost the
  original HTTP response; the payment was not repeated.

The contract verdict itself was **Blocked** because its observed owner was the
zero address. Artifact matching proves the reviewed bytecode identity only; it
does not override deployment-policy blockers.

## CI

`.github/workflows/ci.yml` runs Node 22, `npm ci`, and `npm run test:ci` on
pull requests and pushes to `main`. Live RPC and paid replay remain manual.
