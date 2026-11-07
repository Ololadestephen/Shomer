# Shomer: BOT Chain Delivery Plan

Updated: 2026-11-05.
Status: planning only; this document does not claim implementation or deployment is complete.

## Project And Name

Local repository: /Users/apple/Documents/Shomer
GitHub: https://github.com/Ololadestephen/Shomer
Existing website: https://shomer-ui.pages.dev

Keep Shomer provisionally. Confirm its final name before deploying a new contract or publishing launch posts.

Product: compare an approved deployment policy with actual on-chain ownership, bytecode, proxy, and configuration evidence.

## Existing Foundation

- Working policy engine under src/lib/policy.
- Current X Layer network definitions and chain adapter.
- Existing frontend and Cloudflare Worker API.
- Free verification workflow and existing X Layer payment functionality.
- No project-owned Solidity registry currently implements the proposed BOT Chain publishing workflow.

## Smallest Useful BOT Chain Release

1. Add a BOT Chain adapter alongside existing X Layer support.
2. Bind reports and cache keys to chain ID, target address, policy version, and inspected block.
3. Support the existing generic EVM ownership, runtime-code, and proxy checks that can actually be read.
4. Adapt explorer creation/source lookups; unavailable evidence stays unknown or review-required.
5. Add wallet connection and network switching for report publication.
6. Deploy one small ShomerVerificationRegistry contract.
7. Add Publish Verification and a receipt lookup/comparison view.
8. Add required footer links and focused BOT Chain documentation.

Keep BOT Chain verification/publication free for this release. Preserve the existing X Layer payment service rather than porting x402, USDC, or marketplace billing.

## User Workflow

Choose BOT Chain -> inspect a deployed contract -> approve an explicit policy -> run verification -> review findings -> publish the report fingerprint -> share the transaction and report.

## Registry Scope

Store immutable publication records containing publisher, policy hash, report hash, inspected chain, target contract, and inspected block. Publication time comes from the blockchain.

- Hash a versioned, deterministically serialized public report.
- Scope record identity to the publisher and report context; reject empty hashes and accidental duplicate publications.
- Verify the receipt's chain, registry address, fields, and publisher in the UI.
- A record attests publication and integrity, not audit status or guaranteed contract safety.
- Retain Blocked, Review Required, and Policy Matched semantics.

## Acceptance Checks

- [x] Existing policy-engine checks remain green (`npm run test:engine`, `test:paid`, `test:ship-gate`, `test:x402`, `test:recovery`, `test:api`, `demo:golden`).
- [x] BOT Chain reports never use cached facts from X Layer (`makeFactsCacheKey`, `makeScanCacheKey` scoped by `(chainId, address, block)`).
- [x] Missing explorer data cannot silently produce a passing verdict (`evidence_missing` honest verdict -> `review_required`).
- [x] Registry tests cover record binding, immutability, duplicates, and malformed inputs (`test/ShomerVerificationRegistry.t.sol` 8/8 pass, `scripts/test-registry.ts` passes).
- [x] Report serialization produces stable fingerprints (`canonicalJson`, `canonicalReportPayload`, `computeReportHash`).
- [x] Editing an exported report causes the receipt comparison to fail (`verifyReportIntegrity` detects verdict tampering, block tampering, target contract mismatch, policy mismatch).
- [x] Wrong-network publication is blocked; reverted/pending transactions are handled (`wallet_switchEthereumChain` enforced in UI, with explicit blocking notification).
- [x] UI/API builds and focused mobile/desktop checks pass (`npm run build` with zero TypeScript errors, Vite bundle generated).

---

## Implementation Execution Record (2026-11-05)

### 1. Delivered Capabilities & Architecture
- **Dual-Chain Resolution & Preservation**:
  - `src/lib/chain/botchain.ts` & `src/lib/chain/chains.ts`: defined BOT Chain Mainnet (Chain ID 677, RPC `https://rpc.botchain.ai`, explorer `https://scan.botchain.ai`, native token BOT) and Testnet (Chain ID 968, RPC `https://rpc.bohr.life`, explorer `https://scan.bohr.life`).
  - Preserved legacy X Layer aliases (`mainnet` -> 196, `testnet` -> 1952) and all existing x402 payment and recovery routes.
- **Cache Isolation**:
  - `src/lib/storage.ts`: bound all cache storage keys to `(chainId, contractAddress, blockNumber)`. Lookups are strictly chain-scoped; facts from X Layer are never returned for BOT Chain.
- **Policy Engine & Honest Evidence**:
  - `src/lib/policy/engine.ts` & `src/lib/adapters/xlayer.ts`: dynamic chain resolution for EVM probes; missing explorer deployer/source records yield `evidence_missing` and `review_required` rather than false passes.
- **Solidity Verification Registry**:
  - `contracts/ShomerVerificationRegistry.sol`: immutable records binding publisher, inspected chain, target contract, block, policy hash, report hash, verdict, and timestamp.
  - Enforces duplicate prevention, non-zero addresses/chains/blocks/hashes, and indexed lookup by target contract and publisher.
  - 8 Foundry test suites in `test/ShomerVerificationRegistry.t.sol` passed cleanly.
- **Deterministic Fingerprints & Integrity Verifier**:
  - `src/lib/report/reportSnapshot.ts`: canonical recursive key sorting serializer, public report snapshot builder, keccak256 fingerprinting, record ID calculation matching Solidity, and integrity verifier.
- **Frontend & Web3 Integration**:
  - `index.html` & `src/main.ts`:
    - Chain selection updated with BOT Chain Mainnet and Testnet.
    - One-click sample contract buttons for X Layer (Multicall3) and BOT Chain (CipherBallot).
    - Footer links for BOT Chain website (`https://botchain.ai`), BOTScan Mainnet (677), and BOTScan Testnet (968).
    - Report JSON export (`exportReportJson`).
    - Web3 wallet connection, account display, and network switching enforcement (`publishVerificationReceipt`).
    - Integrity verifier (`handleVerifyIntegrity`) supporting file upload, JSON paste, or on-chain Record ID lookup.

### 2. Test Verification Matrix
All test suites executed cleanly:
- `npm run test:contracts`: 8/8 Foundry tests passed (`testPublishAndRecordBinding`, `testRejectDuplicate`, `testRejectEmptyPolicyHash`, `testRejectEmptyReportHash`, `testRejectInvalidVerdict`, `testRejectZeroInspectedBlock`, `testRejectZeroInspectedChain`, `testRejectZeroTargetContract`).
- `npm run test:ci`:
  - `npm run build`: TypeScript `tsc` + Vite build succeeded.
  - `npm run test:engine`: 31 engine fixtures passed.
  - `npm run test:paid`: Paid deep verification fixtures passed.
  - `npm run test:ship-gate`: Ship-gate deterministic fixtures passed.
  - `npm run test:x402`: Deterministic payment challenge fixtures passed.
  - `npm run test:recovery`: Payment recovery & idempotency passed.
  - `npm run test:api`: API safety & failure mode fixtures passed.
  - `npm run test:registry`: Registry contract specification & encoding tests passed.
  - `npm run test:botchain`: BOT Chain network resolution, policy evaluation, and agent API safety passed.
  - `npm run test:report`: Public report snapshot, deterministic fingerprints, and tampering checks passed.
  - `npm run demo:golden`: Three pinned-block Auditor Brief golden paths passed.
- **Desloppify Status**:
  - Executed desloppify scan on changed workspace scope (`--exclude dist --exclude node_modules --exclude video scan`).
  - Strict score improved (+1.0), mechanical objective score at 60.1 (+4.2), security score 94.7%, file health 88.9%, code quality 87.5%, zero duplicate clusters.

### 3. Pending User / External Program Requirements
The following items require external actions and user authorization before production release:
1. Confirm final name ("Shomer" or alternative) with program coordinator (Anthony).
2. Nominate deployment wallet and receive 1 BOT upfront gas funding.
3. [x] Deployed `ShomerVerificationRegistry` to BOT Chain mainnet at `0xc427474201895710c653105067c543f184c99fa3` (Tx: `0x357f448933d887da964b09ba9da536ae09b6235d9170088f5ddbcddd68e640a2`, Block: #29423939).
4. Execute the four-wallet usage exercise (4 distinct participants inspecting and publishing verification receipts).
5. Publish five standalone project updates and the official launch post on X/Twitter tagging `@botchain_ai`.

## Four-Wallet Usage Exercise

Have four distinct participants inspect a suitable contract and publish their own report records. Keep publisher identities and outcomes visible. Use honest findings, including review-required outcomes when evidence is missing, rather than manufacturing four passing reports.

## Implementation Order

Friday: adapter, minimal registry, publication/lookup UI, and focused tests.
After checks and funding: deploy and connect the registry.
Before Sunday: participant publications, social requirements, and evidence.

Anthony should confirm that this verification-plus-registry workflow meets the unique deployed-project requirement before mainnet work.

## Delivery Target

Target: Sunday, 8 November 2026. This is a working target, subject to the existing app passing its baseline checks and Anthony accepting the scoped integration.

## Program Requirements

- [ ] Anthony confirms the project and its scope in the onboarding document.
- [ ] Nominate a deployment wallet and receive the upfront gas allocation.
- [ ] Deploy the project's functional contract on BOT Chain mainnet.
- [ ] Publish a working website with BOT Chain website and explorer links in its footer.
- [ ] Assign a genuine Telegram contact; one account may cover at most three projects.
- [ ] Prepare five standalone project posts and a separate launch post tagging the official BOT Chain account.
- [ ] Have at least four distinct participating wallets complete relevant successful project transactions.
- [ ] Record website, repository, contract address, deployment hash, usage hashes, Telegram contact, and X links.
- [ ] Send the evidence to Anthony for verification and track the 13 USDT project payment.

The agreed support is 13 USDT after verification plus 1 BOT provided upfront and retained by the developer, less the BOT actually spent. Do not assume a fixed USD value for BOT or an unspecified gas rebate.

## Delivery Boundaries

Keep the existing product, infrastructure, and core design. No new domain purchase is required; an existing hosting subdomain is sufficient. Do not add a token, staking, a relayer, a new payment system, or a broad redesign for this release.

Use dedicated deployment credentials in ignored local environment files. Keep private keys and provider tokens out of plans, commits, screenshots, and submission evidence. Existing changes and historical project evidence must be preserved.

Implementation should follow applicable AGENTS.md instructions and the user's quality policy: scan only the coherent application being changed, test the affected boundaries, and rescan after implementation. Planning does not authorize deployment, posting, committing, or pushing.

## Evidence Packet

- Final project name and one-sentence use case.
- Public website and repository links.
- Mainnet chain ID, contract address, deployment hash, and actual verification status.
- Four distinct participating wallet addresses with successful transaction hashes and action descriptions.
- Screenshots of the principal workflow, transaction confirmation, and mobile layout.
- Five standalone post URLs, launch post URL, and Telegram contact.
- Actual commands and results for relevant tests and production builds.
- Funding received, deployment/usage gas spent, verification date, and payment status.
