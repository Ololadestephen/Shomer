---
format: 1920x1080
duration: 70
fps: 30
music: none
palette: warm ivory, deep moss, lime, muted red, amber
---

# Shomer Evidence Segment

## Frame 01 — Evidence handoff

- time: 0–4s
- visual: Ivory flash resolves into an editorial split frame and dark terminal.
- copy: Three outcomes. No invented pass.
- motion: Terminal rises; cursor glides into position.

## Frame 02 — Policy Matched

- time: 4–14s
- visual: Correct approved owner equals observed owner.
- copy: Policy Matched
- evidence: `0x4dff…0bf8`, pinned block `12345`
- label: DETERMINISTIC FIXTURE REPLAY
- terminal chrome: `shomer · Shomer Verify / result.json`

## Frame 03 — Blocked

- time: 14–25s
- visual: Expected owner and observed owner are compared line by line.
- copy: Blocked
- evidence: expected `0x1111…1111`, observed `0x4dff…0bf8`
- label: DETERMINISTIC FIXTURE REPLAY

## Frame 04 — Review Required

- time: 25–35s
- visual: An undeclared pauser privilege is highlighted in amber.
- copy: Review Required
- evidence: `PAUSER_ROLE` is present but absent from approved policy.
- label: DETERMINISTIC FIXTURE REPLAY

## Frame 05 — Service bridge

- time: 35–40s
- visual: Free and paid marketplace services are shown as two strong rows.
- copy: Shomer Verify / Shomer Deep Verify

## Frame 06 — Paid deep verification

- time: 40–57s
- visual: Sanitized production report, runtime artifact match, privilege map,
  Auditor Brief, then a camera move from artifact match to the zero owner blocker.
- evidence: block `65954437`, hash `0x3b19…ee64`, report
  `shomer-196-65954437-1ba7f41efd1f`
- label: SANITIZED PRODUCTION PROOF

## Frame 07 — Payment recovery

- time: 57–63s
- visual: Settled transaction, recovered report, no second charge.
- copy: Paid once. Report recovered.
- evidence: tx `0x665b…f987`, 0.05 USDC

## Frame 08 — Marketplace listing

- time: 63–67s
- visual: Browser-frame listing card with live URL bar
  `https://www.okx.ai/agents/6117`, ASP #6117 services.
- note: Designed listing card (not a live capture); URL is the real marketplace path.

## Frame 09 — End card

- time: 67–70s (hold ≥2.5s on readable CTA)
- visual: Minimal ivory close with large URL chip.
- copy: Verify the deployment you intended to ship.
- url: okx.ai/agents/6117
- badge: ASP #6117 · SHOMER VERIFY · DEEP VERIFY
