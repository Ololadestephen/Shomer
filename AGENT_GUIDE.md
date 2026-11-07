# Coding Agent Guide: Shomer

Updated: 2026-11-05.
Repository: /Users/apple/Documents/Shomer

This guide is for a coding agent working on the BOT Chain integration. The product scope and acceptance criteria are in plan.md. Reading these files alone does not authorize implementation or external publication; use the user's current task as the authorization.

## Read First

1. Read applicable parent and repository AGENTS.md instructions, including any nested instructions for files you touch.
2. Read plan.md. Its active BOT Chain section defines this release.
3. Read README.md and the package scripts before choosing commands or frameworks.
4. Inspect git status and the existing diff. Preserve all work you did not create.
5. Read the source paths listed below and trace the actual workflow before editing.

The user wants a small extension of an existing working product. Follow existing architecture and UI patterns. Avoid broad refactors, new platforms, new billing, speculative features, and duplicate apps.

## Mission

Add BOT Chain deployment inspection and publication receipts while preserving the existing X Layer product. Retain Shomer provisionally.

## Start Here

- src/lib/chain/xlayer.ts
- src/lib/adapters/xlayer.ts
- src/lib/policy/types.ts, src/lib/policy/engine.ts, and src/lib/policy/policyHash.ts
- src/lib/storage.ts and src/main.ts
- server/agentInput.ts, server/agentVerify.ts, and server/agentShipGate.ts
- server/oklinkProxy.ts
- workers/agent-api/src/index.ts and its environment configuration
- scripts/test-engine-fixtures.ts, scripts/test-ship-gate.ts, and scripts/test-api-safety.ts

## First Concrete Task

Trace how the current mainnet/testnet selector determines the actual chain, explorer, report schema, API input, and cache identity. Do not make mainnet silently change meaning from X Layer to BOT Chain.

Define an explicit chain identity and add BOT Chain without changing previously saved X Layer report semantics.

## Implementation Order

1. Run the baseline deterministic CI checks.
2. Add BOT Chain network selection and a minimal adapter using existing generic EVM probes.
3. Bind observed facts, policy snapshots, report identity, and cache keys to chain ID, address, and pinned block.
4. Adapt explorer-specific lookups. Missing or unsupported evidence remains unknown/review-required.
5. Define a versioned, deterministic public report snapshot using existing hashing helpers where suitable.
6. Add one small verification registry with the approved fields in plan.md and focused contract tests.
7. Add wallet connection/network switching, Publish Verification, and receipt lookup/comparison.
8. Add final setup documentation, footer links, and focused UI checks.
9. Prepare deployment artifacts and the onboarding evidence.

Inspect both server and Worker routes when changing schemas. They must agree on chain identity and error handling.

## Registry And Report Rules

- Immutable records bind publisher, policy hash, report hash, inspected chain, target contract, and inspected block.
- Hash the actual versioned report snapshot; do not depend on incidental JSON key order or a mutable dashboard state.
- Changing the report or context must invalidate the comparison.
- Display publisher and registry details; a third party publishing a report is not automatically its original author.
- A receipt establishes publication/integrity, not safety or an independent audit.
- Keep Blocked, Review Required, and Policy Matched distinct.

## Verification Commands

```bash
npm run test:ci
```

Add focused tests for BOT Chain inputs, cross-chain cache isolation, missing evidence, altered reports, and registry behavior. Choose the smallest contract-test harness compatible with the repository; do not introduce a large framework migration.

Live paid-payment tests are not part of the baseline. Keep the existing X Layer payment service working and leave BOT Chain verification/publication free for this release.

## Scope Boundaries

No new auditing engine, payment-facilitator port, token, USDC deployment, staking, continuous monitoring platform, or visual redesign. Fix only issues introduced or directly exposed by this integration.

## Done Means

A reviewer can inspect a BOT Chain contract, review the real result, publish a receipt, and compare the corresponding report. Existing X Layer behavior and APIs remain correct. Report remaining deployment or onboarding work explicitly.

## Quality And Working Method

- Start with baseline tests and builds for the affected application; record failures that existed before your edits.
- Apply the user's Desloppify policy before and after non-trivial code changes. Check installation and Git ignore rules first, then scan only the coherent application or contract boundary being changed. Review status and next after each scan.
- Exclude generated/dependency output according to the user's policy. Do not scan Documents, Desktop, or unrelated sibling projects.
- If a tool cannot run safely or is unavailable, report it and use the available checks; do not claim a scan or test passed.
- Add focused tests for the new behavior and its failure boundaries. Preserve existing coverage.
- Keep secrets in ignored local environment files; add only blank/example settings to committed templates.
- Verify current official BOT Chain network and deployment information before live use. Avoid copying stale addresses or assuming unrelated-chain infrastructure is deployed.
- Use existing chain and wallet libraries where available. New dependencies should serve an actual requirement and stay within the user's authorization.
- Show concise progress updates, explain intended edits, and carry authorized local work through testing.
- Work independently through reversible implementation tasks. Ask only for missing decisions or permissions that actually block the next action.
- If this guide is resumed later, compare the date with plan.md's target; do not claim an old delivery deadline is still in the future.

## External Actions And Handoff

Follow the user's actual authorization for deployment, paid services, posting, committing, pushing, and pull requests. Complete a reviewable local implementation before requesting an external action that still needs approval.

Do not spend the owner's grant wallet funds or consume unapproved model/TestSprite credits. Do not copy private keys between projects. Use configured deployment credentials without printing them.

When deployment is authorized: check chain ID and signer, estimate cost, run the deployment, confirm its receipt and bytecode, and save the real address/hash/block. Report source verification separately from deployment and from Anthony's project review. Update frontend/server configuration consistently.

Social deliverables can be drafted locally. Public posting and account actions require appropriate user authorization. Four-wallet evidence must identify actual successful transactions and participants without inventing customers, adoption, or account ownership.

At each handoff, append a dated execution note to plan.md covering:
- Files changed and completed acceptance items.
- Commands run and actual outcomes, including baseline failures.
- Deployment evidence, only if a deployment happened.
- Unresolved decisions, credentials, permissions, and next exact action.

Keep implementation-complete, deployed, onboarding-complete, and paid as separate states. Do not mark all program requirements done because a build passes.

## Suggested Starting Prompt

> Read applicable AGENTS.md instructions, plan.md, and AGENT_GUIDE.md. Implement Shomer's bounded BOT Chain inspection and verification-receipt workflow. Start with chain identity and baseline tests, preserve X Layer behavior, and complete focused registry/API/UI verification before reporting the release status.
