# Shomer Auditor Brief — Demo — Undeclared privilege Review

Report: shomer-196-12345-ae7af63611f6
Verdict: review_required
Network: mainnet (chain 196)
Contract: 0x1111111111111111111111111111111111111111
Evidence block: 12345

## Coverage

Matched 6; blocked 0; review 1; evidence missing 0; out of scope 16.

## Findings

### REVIEW — Privileged role observed: PAUSER_ROLE (limited check)

- Expected: Explicit role approval or intentional absence
- Actual: PAUSER_ROLE held by 0x2222222222222222222222222222222222222222
- Why it matters: A privileged AccessControl role was detected, but the approved manifest does not declare role-specific authority. Approval of the same account as owner does not approve this separate privilege.
- Remediation: Confirm and explicitly approve the role in a human review, or revoke it if it is unnecessary. Shomer does not infer role approval from another policy field.
- Evidence: getRoleMember(PAUSER_ROLE)

## Privilege map

2 addresses and 2 relationships discovered; 1 related addresses code-classified.

- 0x1111111111111111111111111111111111111111 —owned_by→ 0x2222222222222222222222222222222222222222
- 0x1111111111111111111111111111111111111111 —access_role:PAUSER_ROLE→ 0x2222222222222222222222222222222222222222

## Reviewed artifact

Comparison status: matched.

## Scope statement

Shomer compares declared policy and reviewed artifact values to observable onchain state at a specific block. This is not a security audit and does not claim the deployment is safe, correct, or free of vulnerabilities.
