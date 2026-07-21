/**
 * Smoke free agent verify (no server required — calls logic directly).
 * For HTTP smoke, run `npm run dev` and curl /api/agent/verify.
 */
import { runAgentVerify } from '../server/agentVerify';

const addr =
  process.argv[2] ?? '0xcA11bde05977b3631167028862bE2a173976CA11';
const tier = process.argv[3] === 'paid' ? 'paid' : 'free';

console.log(`Agent verify (${tier} logic) →`, addr);
const { status, body } = await runAgentVerify(
  {
    network: 'mainnet',
    contractAddress: addr,
    projectName: 'Agent smoke',
    policy: { upgradeable: false },
  },
  tier,
);

console.log('HTTP-equivalent status:', status);
console.log(
  JSON.stringify(
    {
      ok: body.ok,
      verdict: body.verdict,
      coverage: body.coverage,
      block: body.blockNumber,
      owner: body.facts.owner,
      isProxy: body.facts.isProxy,
      results: body.results.map((r) => `${r.status} ${r.checkKey}`),
      error: body.error,
      message: body.message,
      paidFeatures: body.deepVerification?.features,
      privilegeNodes: body.deepVerification?.privilegeMap.nodes.length,
      privilegeEdges: body.deepVerification?.privilegeMap.edges.length,
      artifactStatus: body.deepVerification?.artifactComparison.status,
      auditorBriefId: body.deepVerification?.auditorBrief.reportId,
      auditorBriefDigest: body.deepVerification?.auditorBrief.contentDigest,
    },
    null,
    2,
  ),
);
