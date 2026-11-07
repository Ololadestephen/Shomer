import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  type Address,
  type Hex,
  getAddress,
} from 'viem';
import { shomerRegistryAbi } from '../src/lib/contracts/registryAbi';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

/**
 * Pure TypeScript mirror of ShomerVerificationRegistry.computeRecordId
 */
function computeRecordId(
  publisher: Address,
  inspectedChain: bigint,
  targetContract: Address,
  inspectedBlock: bigint,
  policyHash: Hex,
  reportHash: Hex,
): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, uint256, address, uint256, bytes32, bytes32'),
    [
      getAddress(publisher),
      inspectedChain,
      getAddress(targetContract),
      inspectedBlock,
      policyHash,
      reportHash,
    ],
  );
  return keccak256(encoded);
}

interface SimulatedRecord {
  publisher: Address;
  inspectedChain: bigint;
  targetContract: Address;
  inspectedBlock: bigint;
  policyHash: Hex;
  reportHash: Hex;
  verdict: number;
  publishedAt: bigint;
}

class SimulatedRegistry {
  public records = new Map<Hex, SimulatedRecord>();
  public publisherRecords = new Map<string, Hex[]>();
  public targetRecords = new Map<string, Hex[]>();

  publish(
    publisher: Address,
    inspectedChain: bigint,
    targetContract: Address,
    inspectedBlock: bigint,
    policyHash: Hex,
    reportHash: Hex,
    verdict: number,
    publishedAt = 1730818800n,
  ): Hex {
    if (targetContract === '0x0000000000000000000000000000000000000000') {
      throw new Error('InvalidTargetContract');
    }
    if (inspectedChain === 0n) throw new Error('InvalidInspectedChain');
    if (inspectedBlock === 0n) throw new Error('InvalidInspectedBlock');
    if (policyHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      throw new Error('EmptyPolicyHash');
    }
    if (reportHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      throw new Error('EmptyReportHash');
    }
    if (verdict > 2 || verdict < 0) throw new Error('InvalidVerdict');

    const recordId = computeRecordId(
      publisher,
      inspectedChain,
      targetContract,
      inspectedBlock,
      policyHash,
      reportHash,
    );

    if (this.records.has(recordId)) {
      throw new Error(`RecordAlreadyExists: ${recordId}`);
    }

    const rec: SimulatedRecord = {
      publisher: getAddress(publisher),
      inspectedChain,
      targetContract: getAddress(targetContract),
      inspectedBlock,
      policyHash,
      reportHash,
      verdict,
      publishedAt,
    };

    this.records.set(recordId, rec);

    const pubKey = publisher.toLowerCase();
    const existingPub = this.publisherRecords.get(pubKey) || [];
    this.publisherRecords.set(pubKey, [...existingPub, recordId]);

    const targetKey = `${inspectedChain}:${targetContract.toLowerCase()}`;
    const existingTarget = this.targetRecords.get(targetKey) || [];
    this.targetRecords.set(targetKey, [...existingTarget, recordId]);

    return recordId;
  }
}

async function runTests(): Promise<void> {
  console.log('Testing ShomerVerificationRegistry contract specification & encoding...');

  // 1. ABI integrity
  assert(shomerRegistryAbi.length > 0, 'Registry ABI must not be empty');
  const publishFn = shomerRegistryAbi.find((item) => item.type === 'function' && item.name === 'publishVerification');
  assert(Boolean(publishFn), 'publishVerification function must exist in ABI');

  const registry = new SimulatedRegistry();

  const alice: Address = '0x1111111111111111111111111111111111111111';
  const bob: Address = '0x2222222222222222222222222222222222222222';
  const target: Address = '0x3C250cBf439431D7dd8525Ca9800c577a9533e3C';
  const policyH: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const reportH: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const botChainId = 677n;
  const blockNumber = 19263053n;

  // 2. Publication and record binding
  const id1 = registry.publish(alice, botChainId, target, blockNumber, policyH, reportH, 2);
  assert(id1.startsWith('0x') && id1.length === 66, 'Record ID must be a 32-byte hex string');
  assert(registry.records.size === 1, 'Registry must contain 1 record');

  const rec1 = registry.records.get(id1)!;
  assert(rec1.publisher.toLowerCase() === alice.toLowerCase(), 'Publisher must match');
  assert(rec1.inspectedChain === botChainId, 'Chain must match');
  assert(rec1.targetContract.toLowerCase() === target.toLowerCase(), 'Target contract must match');
  assert(rec1.inspectedBlock === blockNumber, 'Block must match');
  assert(rec1.policyHash === policyH, 'Policy hash must match');
  assert(rec1.reportHash === reportH, 'Report hash must match');
  assert(rec1.verdict === 2, 'Verdict must match');
  console.log('ok: publication and field binding match expected schema');

  // 3. Duplicate rejection for same publisher
  let dupThrew = false;
  try {
    registry.publish(alice, botChainId, target, blockNumber, policyH, reportH, 2);
  } catch (err) {
    dupThrew = (err as Error).message.includes('RecordAlreadyExists');
  }
  assert(dupThrew, 'Duplicate publication must revert');
  console.log('ok: duplicate publication rejected for same publisher');

  // 4. Distinct publisher gets separate record ID
  const idBob = registry.publish(bob, botChainId, target, blockNumber, policyH, reportH, 2);
  assert(idBob !== id1, 'Different publisher must yield distinct record ID');
  assert(registry.records.size === 2, 'Registry must contain 2 records');
  console.log('ok: multiple distinct publishers are tracked with isolated record IDs');

  // 5. Index lookups
  const targetRecs = registry.targetRecords.get(`${botChainId}:${target.toLowerCase()}`) || [];
  assert(targetRecs.length === 2, 'Target should have 2 records from distinct publishers');
  assert(targetRecs.includes(id1) && targetRecs.includes(idBob), 'Target records must include both publications');
  console.log('ok: target contract query indexes all publications across publishers');

  // 6. Malformed inputs fail closed
  const zeroAddr: Address = '0x0000000000000000000000000000000000000000';
  const zeroHash: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

  let zeroTargetThrew = false;
  try {
    registry.publish(alice, botChainId, zeroAddr, blockNumber, policyH, reportH, 2);
  } catch (err) {
    zeroTargetThrew = (err as Error).message.includes('InvalidTargetContract');
  }
  assert(zeroTargetThrew, 'Zero target address must revert');

  let zeroChainThrew = false;
  try {
    registry.publish(alice, 0n, target, blockNumber, policyH, reportH, 2);
  } catch (err) {
    zeroChainThrew = (err as Error).message.includes('InvalidInspectedChain');
  }
  assert(zeroChainThrew, 'Zero chain must revert');

  let zeroBlockThrew = false;
  try {
    registry.publish(alice, botChainId, target, 0n, policyH, reportH, 2);
  } catch (err) {
    zeroBlockThrew = (err as Error).message.includes('InvalidInspectedBlock');
  }
  assert(zeroBlockThrew, 'Zero block must revert');

  let emptyPolicyThrew = false;
  try {
    registry.publish(alice, botChainId, target, blockNumber, zeroHash, reportH, 2);
  } catch (err) {
    emptyPolicyThrew = (err as Error).message.includes('EmptyPolicyHash');
  }
  assert(emptyPolicyThrew, 'Empty policy hash must revert');

  let emptyReportThrew = false;
  try {
    registry.publish(alice, botChainId, target, blockNumber, policyH, zeroHash, 2);
  } catch (err) {
    emptyReportThrew = (err as Error).message.includes('EmptyReportHash');
  }
  assert(emptyReportThrew, 'Empty report hash must revert');

  let invalidVerdictThrew = false;
  try {
    registry.publish(alice, botChainId, target, blockNumber, policyH, reportH, 5);
  } catch (err) {
    invalidVerdictThrew = (err as Error).message.includes('InvalidVerdict');
  }
  assert(invalidVerdictThrew, 'Invalid verdict must revert');
  console.log('ok: malformed inputs (zero address, zero chain, zero block, empty hashes, invalid verdict) rejected');

  console.log('All registry tests passed.');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
