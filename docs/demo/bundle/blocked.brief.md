# Shomer Auditor Brief — Demo — Wrong owner Blocked

Report: shomer-196-12345-2ba100e2d244
Verdict: blocked
Network: mainnet (chain 196)
Contract: 0x1111111111111111111111111111111111111111
Evidence block: 12345

## Coverage

Matched 5; blocked 1; review 0; evidence missing 0; out of scope 16.

## Findings

### BLOCKED — Owner matches declared Safe / owner

- Expected: 0x3333333333333333333333333333333333333333
- Actual: 0x2222222222222222222222222222222222222222
- Why it matters: Contract ownership does not match the address approved in the launch policy.
- Remediation: Transfer ownership to 0x3333333333333333333333333333333333333333, then re-run verification.
- Evidence: owner()

## Privilege map

2 addresses and 1 relationships discovered; 1 related addresses code-classified.

- 0x1111111111111111111111111111111111111111 —owned_by→ 0x2222222222222222222222222222222222222222

## Reviewed artifact

Comparison status: matched.

## Scope statement

Shomer compares declared policy and reviewed artifact values to observable onchain state at a specific block. This is not a security audit and does not claim the deployment is safe, correct, or free of vulnerabilities.
