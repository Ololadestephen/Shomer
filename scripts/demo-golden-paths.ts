import assert from 'node:assert/strict';
import { runAgentVerify } from '../server/agentVerify';
import {
  FIXTURE_CONTRACT,
  FIXTURE_OWNER,
  makeObservedFacts,
} from './fixtures/observedFacts';

const WRONG_OWNER = '0x3333333333333333333333333333333333333333';
const RUNTIME_HASH = `0x${'ab'.repeat(32)}`;

type ExpectedVerdict = 'policy_matched' | 'blocked' | 'review_required';

async function demonstrate(input: {
  label: string;
  expectedVerdict: ExpectedVerdict;
  owner: string;
  undeclaredPrivilege?: boolean;
}) {
  const facts = makeObservedFacts(
    input.undeclaredPrivilege
      ? {
          roles: [{
            role: 'PAUSER_ROLE',
            holders: [FIXTURE_OWNER],
            evidence: {
              source: 'getRoleMember(PAUSER_ROLE)',
              block: 12_345,
              raw: FIXTURE_OWNER,
            },
          }],
        }
      : {},
  );
  const result = await runAgentVerify(
    {
      network: 'mainnet',
      contractAddress: FIXTURE_CONTRACT,
      projectName: `Golden path — ${input.label}`,
      blockNumber: facts.blockNumber,
      policy: {
        owner: input.owner,
        upgradeable: false,
      },
      reviewedArtifact: {
        name: 'Pinned reviewed runtime',
        reviewedCommit: 'demo-reviewed-commit',
        runtimeCodeHash: RUNTIME_HASH,
      },
    },
    'paid',
    {
      facts,
      inspectRelatedAddresses: async () => [],
    },
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.verdict, input.expectedVerdict);
  assert.equal(result.body.blockNumber, 12_345);
  const brief = result.body.deepVerification?.auditorBrief;
  assert.ok(brief, `${input.label}: Auditor Brief must exist`);
  assert.equal(brief.scope.blockNumber, 12_345);
  assert.equal(brief.verdict, input.expectedVerdict);
  assert.match(brief.markdown, /Evidence block: 12345/);
  assert.ok(
    brief.evidenceIndex.every(
      (entry) => entry.evidence.block === undefined || entry.evidence.block === 12_345,
    ),
    `${input.label}: every block-bearing evidence record is pinned`,
  );

  console.log(`\n${input.label}`);
  console.log(`  Verdict: ${result.body.verdict}`);
  console.log(`  Block: ${result.body.blockNumber}`);
  console.log(`  Auditor Brief: ${brief.reportId}`);
  console.log(`  Artifact: ${result.body.deepVerification?.artifactComparison.status}`);
  console.log(`  Findings: ${brief.findings.length}`);
}

await demonstrate({
  label: 'Correct approved policy',
  expectedVerdict: 'policy_matched',
  owner: FIXTURE_OWNER,
});
await demonstrate({
  label: 'Wrong owner / authority',
  expectedVerdict: 'blocked',
  owner: WRONG_OWNER,
});
await demonstrate({
  label: 'Undeclared privilege',
  expectedVerdict: 'review_required',
  owner: FIXTURE_OWNER,
  undeclaredPrivilege: true,
});

console.log('\nThree pinned-block Auditor Brief golden paths passed.');

