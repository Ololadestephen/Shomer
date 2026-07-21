import type {
  CheckResult,
  Coverage,
  ManifestFields,
  ObservedFacts,
  ScanRun,
  SkipReason,
  Verdict,
} from './types';
import {
  addressesEqual,
  formatCodeHash,
  isEmptyField,
  isZeroOrPlaceholder,
  normalizeAddress,
  parseAddressList,
  shortAddress,
} from '../utils/address';

/** How to treat onchain values observed when the policy did not declare them. */
export type UndeclaredObservedMode = 'review' | 'out_of_scope';

export interface PolicyCheckOptions {
  /**
   * When policy omits a field but chain has a value:
   * - `review` (default): flag for human/agent attention
   * - `out_of_scope`: ignore (agent noise reduction). Never hides real mismatches.
   */
  undeclaredObserved?: UndeclaredObservedMode;
}

function undeclaredMode(opts?: PolicyCheckOptions): UndeclaredObservedMode {
  return opts?.undeclaredObserved === 'out_of_scope' ? 'out_of_scope' : 'review';
}


function coverageOf(results: CheckResult[]): Coverage {
  const skipped = results.filter((r) => r.status === 'skipped');
  return {
    matched: results.filter((r) => r.status === 'matched').length,
    review: results.filter((r) => r.status === 'review').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
    skipped: skipped.length,
    outOfScope: skipped.filter((r) => r.skipReason === 'out_of_scope').length,
    evidenceMissing: skipped.filter((r) => r.skipReason === 'evidence_missing').length,
    total: results.length,
  };
}

export function verdictOf(results: CheckResult[]): Verdict {
  if (results.length === 0) return 'review_required';
  if (results.some((r) => r.status === 'blocked')) return 'blocked';
  if (results.some((r) => r.status === 'review')) return 'review_required';
  // Declared/required field with missing evidence is incomplete — never invent Policy Matched
  if (results.some((r) => r.status === 'skipped' && r.skipReason === 'evidence_missing')) {
    return 'review_required';
  }
  // Only out-of-scope skips (no matches) still need human review
  if (!results.some((r) => r.status === 'matched')) {
    return 'review_required';
  }
  // Matched + only out_of_scope skips → Policy Matched for defined checks that ran
  return 'policy_matched';
}

function skipped(
  checkKey: string,
  title: string,
  expected: string,
  actual: string,
  evidence: CheckResult['evidence'],
  why: string,
  skipReason: SkipReason,
  severity: CheckResult['severity'] = 'info',
  remediation?: string,
): CheckResult {
  return {
    id: checkKey,
    checkKey,
    status: 'skipped',
    title,
    expected,
    actual,
    evidence,
    why,
    remediation,
    severity,
    skipReason,
  };
}

function checkChainAndDeployer(m: ManifestFields, f: ObservedFacts, opts?: PolicyCheckOptions): CheckResult {
  const expectedChain = m.network === 'mainnet' ? 196 : 1952;
  const chainOk = f.chainId === expectedChain;
  const expectDeployer = normalizeAddress(m.expectedDeployer);
  const actualDeployer = f.deployer;

  if (!chainOk) {
    return {
      id: 'chain_and_deployer',
      checkKey: 'chain_and_deployer',
      status: 'blocked',
      title: 'Correct chain',
      expected: `Chain ID ${expectedChain} (${m.network})`,
      actual: `Chain ID ${f.chainId}`,
      evidence: {
        source: 'eth_chainId via RPC',
        block: f.blockNumber,
        raw: String(f.chainId),
      },
      why: 'Verification ran against a different chain than the launch policy specifies.',
      remediation: 'Select the correct X Layer network and re-run against the intended deployment.',
      severity: 'critical',
    };
  }

  if (!expectDeployer && !actualDeployer) {
    return skipped(
      'chain_and_deployer',
      'Correct chain and approved deployer',
      'Chain OK; deployer not declared',
      `Chain ${f.chainId}; deployer not observed`,
      {
        source: 'eth_chainId + creation-info lookup',
        block: f.blockNumber,
        note: 'Chain matches. Deployer could not be read from public APIs and was not set in the manifest.',
      },
      'Chain is correct. Deployer comparison is out of scope — neither policy nor public APIs provide a deployer.',
      'out_of_scope',
    );
  }

  if (expectDeployer && !actualDeployer) {
    return skipped(
      'chain_and_deployer',
      'Correct chain and approved deployer',
      `Chain ${expectedChain}; deployer ${shortAddress(expectDeployer)}`,
      `Chain ${f.chainId}; deployer not available from public APIs`,
      {
        source: 'creation-info / explorer API',
        block: f.blockNumber,
        note: f.readErrors.find((e) => e.toLowerCase().includes('deployer')) ??
          'Deployer lookup unavailable without explorer API key.',
      },
      'Policy declares an approved deployer, but Shomer could not observe the creation transaction.',
      'evidence_missing',
      'medium',
      'Set OKLINK_API_KEY in .env and re-run via npm run dev (server proxy), or confirm deployer on the OKX explorer. Do not treat this as a pass.',
    );
  }

  if (!expectDeployer && actualDeployer) {
    if (undeclaredMode(opts) === 'out_of_scope') {
      return skipped(
        'chain_and_deployer',
        'Correct chain and approved deployer',
        `Chain ${expectedChain}; deployer not declared`,
        `Chain ${f.chainId}; deployer ${actualDeployer}`,
        {
          source: 'creation-info lookup',
          txHash: f.deployTxHash ?? undefined,
          block: f.blockNumber,
          raw: actualDeployer,
        },
        'Deployer observed but undeclared — out of scope per agent options.',
        'out_of_scope',
      );
    }
    return {
      id: 'chain_and_deployer',
      checkKey: 'chain_and_deployer',
      status: 'review',
      title: 'Correct chain and approved deployer',
      expected: `Chain ${expectedChain}; deployer not declared in manifest`,
      actual: `Chain ${f.chainId}; deployer ${actualDeployer}`,
      evidence: {
        source: 'creation-info lookup',
        txHash: f.deployTxHash ?? undefined,
        block: f.blockNumber,
        raw: actualDeployer,
      },
      why: 'Onchain deployer was observed but not declared in the launch policy.',
      remediation: 'Add the approved deployer address to the Launch Manifest and re-run.',
      severity: 'medium',
    };
  }

  const match = addressesEqual(expectDeployer, actualDeployer);
  return {
    id: 'chain_and_deployer',
    checkKey: 'chain_and_deployer',
    status: match ? 'matched' : 'blocked',
    title: 'Correct chain and approved deployer',
    expected: `Chain ${expectedChain}; ${expectDeployer}`,
    actual: `Chain ${f.chainId}; ${actualDeployer}`,
    evidence: {
      source: 'eth_chainId + creation-info',
      txHash: f.deployTxHash ?? undefined,
      block: f.blockNumber,
      raw: `deployer=${actualDeployer}`,
    },
    why: match
      ? undefined
      : 'The account that deployed this contract is not the approved deployer.',
    remediation: match
      ? undefined
      : 'Redeploy from the approved deployer or update the policy only if this was intentional and reviewed.',
    severity: match ? 'info' : 'critical',
  };
}

function checkOwner(m: ManifestFields, f: ObservedFacts, opts?: PolicyCheckOptions): CheckResult {
  const expectedOwner = normalizeAddress(m.owner) ?? normalizeAddress(m.expectedSafe);
  const expectsSafe = !isEmptyField(m.expectedSafe);

  if (!f.hasCode) {
    return {
      id: 'owner_matches',
      checkKey: 'owner_matches',
      status: 'blocked',
      title: 'Owner matches declared Safe / owner',
      expected: expectedOwner ?? 'Declared owner',
      actual: 'No contract code at address',
      evidence: {
        source: 'getCode',
        block: f.blockNumber,
        raw: 'empty bytecode',
      },
      why: 'There is no contract to verify ownership against.',
      remediation: 'Confirm the contract address and network.',
      severity: 'critical',
    };
  }

  if (!f.owner) {
    if (expectedOwner) {
      return skipped(
        'owner_matches',
        'Owner matches declared Safe / owner',
        expectedOwner,
        'owner() not readable',
        {
          source: 'owner()',
          block: f.blockNumber,
          note: 'Contract does not expose a standard Ownable owner() getter, or the call reverted.',
        },
        'Policy declares an owner, but ownership could not be read with a standard Ownable interface.',
        'evidence_missing',
        'medium',
        'Confirm the contract implements owner() or verify ownership on the explorer, then re-run.',
      );
    }
    return skipped(
      'owner_matches',
      'Owner matches declared Safe / owner',
      'Not declared',
      'owner() not readable',
      {
        source: 'owner()',
        block: f.blockNumber,
        note: 'No owner in manifest and no standard owner() onchain — ownership comparison out of scope.',
      },
      'Ownership is out of scope: not declared in the manifest and not readable onchain.',
      'out_of_scope',
    );
  }

  if (!expectedOwner) {
    const actual = `${f.owner}${f.isSafe ? ` · Safe ${f.safeThreshold}/${f.safeOwners?.length ?? '?'}` : f.isOwnerContract ? ' · contract' : ' · EOA'}`;
    if (undeclaredMode(opts) === 'out_of_scope') {
      return skipped(
        'owner_matches',
        'Owner matches declared Safe / owner',
        'Not declared in manifest',
        actual,
        {
          source: f.ownerReadMethod ?? 'owner()',
          block: f.blockNumber,
          raw: f.owner,
          note: f.safeEvidence?.note,
        },
        'Owner observed but undeclared — out of scope per agent options.',
        'out_of_scope',
      );
    }
    return {
      id: 'owner_matches',
      checkKey: 'owner_matches',
      status: 'review',
      title: 'Owner matches declared Safe / owner',
      expected: 'Not declared in manifest',
      actual,
      evidence: {
        source: f.ownerReadMethod ?? 'owner()',
        block: f.blockNumber,
        raw: f.owner,
        note: f.safeEvidence?.note,
      },
      why: 'An owner was observed onchain but no owner/Safe was declared in the launch policy.',
      remediation: 'Declare the approved owner or Safe in the Launch Manifest.',
      severity: 'high',
    };
  }

  if (!addressesEqual(expectedOwner, f.owner)) {
    return {
      id: 'owner_matches',
      checkKey: 'owner_matches',
      status: 'blocked',
      title: 'Owner matches declared Safe / owner',
      expected: expectedOwner,
      actual: f.owner,
      evidence: {
        source: f.ownerReadMethod ?? 'owner()',
        block: f.blockNumber,
        raw: f.owner,
      },
      why: 'Contract ownership does not match the address approved in the launch policy.',
      remediation: `Transfer ownership to ${expectedOwner}, then re-run verification.`,
      severity: 'critical',
    };
  }

  // Owner address matches — if policy expects Safe, verify Safe shape
  if (expectsSafe) {
    if (f.isSafe === false) {
      return {
        id: 'owner_matches',
        checkKey: 'owner_matches',
        status: 'blocked',
        title: 'Owner matches declared Safe / owner',
        expected: `${expectedOwner} · Safe / multisig`,
        actual: `${f.owner} · ${f.isOwnerContract ? 'non-Safe contract' : 'EOA'}`,
        evidence: f.safeEvidence ?? {
          source: 'getCode(owner) + Safe getters',
          block: f.blockNumber,
        },
        why: 'Policy expects a Safe/multisig owner, but the owner is not a confirmed Safe.',
        remediation: 'Transfer ownership to the approved Safe, or correct the policy if an EOA was intentional (not recommended).',
        severity: 'critical',
      };
    }
    if (f.isSafe === null) {
      return {
        id: 'owner_matches',
        checkKey: 'owner_matches',
        status: 'review',
        title: 'Owner matches declared Safe / owner',
        expected: `${expectedOwner} · Safe / multisig`,
        actual: `${f.owner} · Safe interface unconfirmed`,
        evidence: f.safeEvidence ?? {
          source: 'Safe interface probe',
          block: f.blockNumber,
        },
        why: 'Owner address matches, but Shomer could not confirm Gnosis Safe getters.',
        remediation: 'Manually confirm the owner is the intended Safe on the explorer.',
        severity: 'high',
      };
    }
    if (
      m.minMultisigThreshold !== null &&
      f.safeThreshold !== null &&
      f.safeThreshold < m.minMultisigThreshold
    ) {
      return {
        id: 'owner_matches',
        checkKey: 'owner_matches',
        status: 'blocked',
        title: 'Owner matches declared Safe / owner',
        expected: `Safe threshold ≥ ${m.minMultisigThreshold}`,
        actual: `Safe threshold ${f.safeThreshold} of ${f.safeOwners?.length ?? '?'}`,
        evidence: f.safeEvidence ?? { source: 'getThreshold()', block: f.blockNumber },
        why: 'Multisig threshold is below the minimum approved in the launch policy.',
        remediation: 'Raise the Safe threshold to meet policy, then re-run.',
        severity: 'critical',
      };
    }
  } else if (f.isSafe === false && f.owner && !f.isOwnerContract) {
    // No Safe declared: EOA owner is allowed if intentional, but flag as review when threshold policy is empty
    // (founders often forget Safe). Keep matched if they only declared owner as EOA without Safe expectation.
  }

  // Harden: if owner matches and is Safe but threshold was declared and unreadable after match path
  if (
    expectsSafe &&
    f.isSafe === true &&
    m.minMultisigThreshold !== null &&
    f.safeThreshold === null
  ) {
    return {
      id: 'owner_matches',
      checkKey: 'owner_matches',
      status: 'review',
      title: 'Owner matches declared Safe / owner',
      expected: `Safe threshold ≥ ${m.minMultisigThreshold}`,
      actual: `${f.owner} · Safe confirmed but threshold unreadable`,
      evidence: f.safeEvidence ?? { source: 'getThreshold()', block: f.blockNumber },
      why: 'Safe owner matches, but threshold could not be read for comparison.',
      remediation: 'Confirm threshold on the explorer or re-run when Safe getters are available.',
      severity: 'high',
    };
  }

  return {
    id: 'owner_matches',
    checkKey: 'owner_matches',
    status: 'matched',
    title: 'Owner matches declared Safe / owner',
    expected: expectsSafe
      ? `${expectedOwner} · Safe${m.minMultisigThreshold ? ` ≥ ${m.minMultisigThreshold}` : ''}`
      : expectedOwner,
    actual: `${f.owner}${f.isSafe ? ` · Safe ${f.safeThreshold}/${f.safeOwners?.length ?? '?'}` : f.isOwnerContract ? ' · contract' : ' · EOA'}`,
    evidence: {
      source: f.ownerReadMethod ?? 'owner()',
      block: f.blockNumber,
      raw: f.owner,
      note: f.safeEvidence?.raw,
    },
    severity: 'info',
  };
}

function checkUpgradeAuthority(m: ManifestFields, f: ObservedFacts): CheckResult {
  if (!m.upgradeable) {
    if (f.isProxy) {
      return {
        id: 'upgrade_authority',
        checkKey: 'upgrade_authority',
        status: 'review',
        title: 'Upgrade authority matches policy',
        expected: 'Not upgradeable per manifest',
        actual: `Proxy detected · impl ${shortAddress(f.implementation)}`,
        evidence: f.upgradeEvidence ?? {
          source: 'EIP-1967',
          block: f.blockNumber,
        },
        why: 'Manifest says non-upgradeable, but a proxy implementation slot was found.',
        remediation: 'Update the manifest if this is a proxy, or investigate unexpected proxy wiring.',
        severity: 'high',
      };
    }
    return {
      id: 'upgrade_authority',
      checkKey: 'upgrade_authority',
      status: 'matched',
      title: 'Upgrade authority matches policy',
      expected: 'Not upgradeable',
      actual: f.isProxy === false ? 'No EIP-1967 proxy detected' : 'Proxy status unknown',
      evidence: f.upgradeEvidence ?? {
        source: 'EIP-1967 probe',
        block: f.blockNumber,
      },
      severity: 'info',
    };
  }

  const expectedAuth = normalizeAddress(m.expectedProxyAdminOrUpgradeAuthority);
  // Harden: proxy admin vs UUPS owner — if both present and diverge from policy, still compare upgradeAuthority
  if (f.proxyAdmin && f.owner && !addressesEqual(f.proxyAdmin, f.owner) && expectedAuth) {
    // Prefer explicit admin when comparing; upgradeAuthority should already be proxyAdmin when set
  }
  if (!f.isProxy && !f.upgradeAuthority) {
    return {
      id: 'upgrade_authority',
      checkKey: 'upgrade_authority',
      status: 'blocked',
      title: 'Upgrade authority matches policy',
      expected: expectedAuth ?? 'Upgradeable with declared upgrade authority',
      actual: 'No proxy / upgrade authority observed',
      evidence: f.upgradeEvidence ?? {
        source: 'EIP-1967 + owner',
        block: f.blockNumber,
        note: 'Manifest marks upgradeable, but no proxy slot or upgrade path was found.',
      },
      why: 'Policy requires an upgradeable deployment, but no proxy implementation or upgrade authority was observed.',
      remediation: 'Confirm you are verifying the proxy address (not the implementation), or correct the upgradeable flag.',
      severity: 'critical',
    };
  }

  if (!expectedAuth) {
    return {
      id: 'upgrade_authority',
      checkKey: 'upgrade_authority',
      status: 'review',
      title: 'Upgrade authority matches policy',
      expected: 'Not declared',
      actual: f.upgradeAuthority
        ? f.upgradeAuthority
        : `Proxy admin ${f.proxyAdmin ?? '—'}; owner ${f.owner ?? '—'}`,
      evidence: f.upgradeEvidence ?? { source: 'EIP-1967', block: f.blockNumber },
      why: 'Upgradeable deployment observed but no upgrade authority declared in the manifest.',
      remediation: 'Declare the expected proxy admin or UUPS upgrade authority.',
      severity: 'high',
    };
  }

  if (!f.upgradeAuthority) {
    return skipped(
      'upgrade_authority',
      'Upgrade authority matches policy',
      expectedAuth,
      'Upgrade authority not determined',
      {
        source: 'EIP-1967 admin slot / owner',
        block: f.blockNumber,
        note: 'Could not resolve upgrade authority from admin slot or owner.',
      },
      'Policy declares an upgrade authority, but it could not be resolved from the admin slot or owner.',
      'evidence_missing',
      'medium',
      'Confirm proxy admin / UUPS owner on the explorer and re-run.',
    );
  }

  const match = addressesEqual(expectedAuth, f.upgradeAuthority);
  return {
    id: 'upgrade_authority',
    checkKey: 'upgrade_authority',
    status: match ? 'matched' : 'blocked',
    title: 'Upgrade authority matches policy',
    expected: expectedAuth,
    actual: f.upgradeAuthority,
    evidence: f.upgradeEvidence ?? {
      source: f.proxyAdmin ? 'EIP-1967 admin' : 'owner() as UUPS authority',
      block: f.blockNumber,
      raw: f.upgradeAuthority,
    },
    why: match
      ? undefined
      : 'The account that can upgrade this proxy is not the approved authority.',
    remediation: match
      ? undefined
      : `Transfer proxy admin / upgrade rights to ${expectedAuth}.`,
    severity: match ? 'info' : 'critical',
  };
}

function checkTimelock(m: ManifestFields, f: ObservedFacts): CheckResult {
  if (!m.timelockRequired) {
    if (f.timelockMinDelaySec !== null) {
      return {
        id: 'timelock_delay',
        checkKey: 'timelock_delay',
        status: 'matched',
        title: 'Timelock meets policy',
        expected: 'Timelock not required',
        actual: `Timelock observed · ${f.timelockMinDelaySec}s at ${shortAddress(f.timelockAddress)}`,
        evidence: f.timelockEvidence ?? { source: 'getMinDelay()', block: f.blockNumber },
        severity: 'info',
      };
    }
    return {
      id: 'timelock_delay',
      checkKey: 'timelock_delay',
      status: 'matched',
      title: 'Timelock meets policy',
      expected: 'Timelock not required',
      actual: 'No timelock required or observed',
      evidence: f.timelockEvidence ?? { source: 'getMinDelay() probe', block: f.blockNumber },
      severity: 'info',
    };
  }

  if (f.timelockMinDelaySec === null) {
    return {
      id: 'timelock_delay',
      checkKey: 'timelock_delay',
      status: 'blocked',
      title: 'Timelock meets policy',
      expected: `Timelock required${m.minTimelockDelaySec ? ` · ≥ ${m.minTimelockDelaySec}s` : ''}`,
      actual: 'No TimelockController getMinDelay() found on owner/admin',
      evidence: f.timelockEvidence ?? {
        source: 'getMinDelay() probe',
        block: f.blockNumber,
        note: 'Probed owner, proxy admin, and upgrade authority.',
      },
      why: 'Policy requires a timelock, but none was observed on privileged addresses.',
      remediation: 'Route ownership/admin through a TimelockController that meets the minimum delay.',
      severity: 'critical',
    };
  }

  if (m.minTimelockDelaySec !== null && f.timelockMinDelaySec < m.minTimelockDelaySec) {
    return {
      id: 'timelock_delay',
      checkKey: 'timelock_delay',
      status: 'blocked',
      title: 'Timelock meets policy',
      expected: `≥ ${m.minTimelockDelaySec} seconds`,
      actual: `${f.timelockMinDelaySec} seconds at ${f.timelockAddress}`,
      evidence: f.timelockEvidence ?? { source: 'getMinDelay()', block: f.blockNumber },
      why: 'Timelock delay is shorter than the minimum approved in the launch policy.',
      remediation: 'Increase getMinDelay() to meet the policy minimum.',
      severity: 'critical',
    };
  }

  return {
    id: 'timelock_delay',
    checkKey: 'timelock_delay',
    status: 'matched',
    title: 'Timelock meets policy',
    expected: m.minTimelockDelaySec
      ? `≥ ${m.minTimelockDelaySec} seconds`
      : 'Timelock present',
    actual: `${f.timelockMinDelaySec} seconds at ${f.timelockAddress}`,
    evidence: f.timelockEvidence ?? { source: 'getMinDelay()', block: f.blockNumber },
    severity: 'info',
  };
}

function checkImplementation(m: ManifestFields, f: ObservedFacts): CheckResult {
  const expectedImpl = normalizeAddress(m.expectedImplementation);
  const expectedHash = m.expectedImplementationCodeHash.trim().toLowerCase();

  if (!m.upgradeable && !expectedImpl && !expectedHash) {
    // Still record runtime code hash of the contract itself
    if (f.codeHash) {
      return {
        id: 'implementation_hash',
        checkKey: 'implementation_hash',
        status: 'matched',
        title: 'Implementation / code hash',
        expected: 'No specific implementation required (non-upgradeable)',
        actual: `Contract codehash ${f.codeHash}`,
        evidence: {
          source: 'extcodehash / keccak256(bytecode)',
          block: f.blockNumber,
          raw: f.codeHash,
        },
        severity: 'info',
      };
    }
    return skipped(
      'implementation_hash',
      'Implementation / code hash',
      'No specific implementation required (non-upgradeable)',
      'No codehash (empty code)',
      {
        source: 'extcodehash / keccak256(bytecode)',
        block: f.blockNumber,
        raw: 'empty',
      },
      'No bytecode — cannot record code hash.',
      'evidence_missing',
      'medium',
    );
  }

  if (m.upgradeable || expectedImpl || expectedHash) {
    if (!f.implementation && m.upgradeable) {
      return {
        id: 'implementation_hash',
        checkKey: 'implementation_hash',
        status: 'review',
        title: 'Implementation / code hash',
        expected: expectedImpl ?? (expectedHash || 'Declared implementation'),
        actual: 'Implementation address not observed',
        evidence: f.upgradeEvidence ?? {
          source: 'EIP-1967 implementation slot',
          block: f.blockNumber,
        },
        why: 'Could not read proxy implementation; cannot confirm reviewed bytecode.',
        remediation: 'Confirm you are scanning the proxy address, not a non-proxy target.',
        severity: 'high',
      };
    }

    if (expectedImpl && f.implementation && !addressesEqual(expectedImpl, f.implementation)) {
      return {
        id: 'implementation_hash',
        checkKey: 'implementation_hash',
        status: 'blocked',
        title: 'Implementation / code hash',
        expected: expectedImpl,
        actual: f.implementation,
        evidence: f.upgradeEvidence ?? {
          source: 'EIP-1967',
          block: f.blockNumber,
          raw: f.implementation,
        },
        why: 'Live implementation address does not match the reviewed artifact address.',
        remediation: 'Point the proxy at the reviewed implementation or update the policy after review.',
        severity: 'critical',
      };
    }

    if (expectedHash) {
      const actualHash = (f.implementationCodeHash ?? f.codeHash)?.toLowerCase();
      if (!actualHash) {
        return skipped(
          'implementation_hash',
          'Implementation / code hash',
          expectedHash,
          'Code hash not available',
          {
            source: 'extcodehash',
            block: f.blockNumber,
          },
          'Policy declares a code hash, but none could be computed onchain.',
          'evidence_missing',
          'medium',
          'Confirm the contract has code at this address and re-run.',
        );
      }
      const match = actualHash === expectedHash;
      return {
        id: 'implementation_hash',
        checkKey: 'implementation_hash',
        status: match ? 'matched' : 'blocked',
        title: 'Implementation / code hash',
        expected: expectedHash,
        actual: actualHash,
        evidence: {
          source: f.implementationCodeHash
            ? 'keccak256(implementation bytecode)'
            : 'keccak256(contract bytecode)',
          block: f.blockNumber,
          raw: actualHash,
        },
        why: match
          ? undefined
          : 'Onchain bytecode hash does not match the hash recorded in the launch policy.',
        remediation: match
          ? undefined
          : 'Deploy the reviewed implementation or update the manifest only after re-review.',
        severity: match ? 'info' : 'critical',
      };
    }

    if (expectedImpl && f.implementation && addressesEqual(expectedImpl, f.implementation)) {
      return {
        id: 'implementation_hash',
        checkKey: 'implementation_hash',
        status: 'matched',
        title: 'Implementation / code hash',
        expected: expectedImpl,
        actual: `${f.implementation}${f.implementationCodeHash ? ` · ${formatCodeHash(f.implementationCodeHash)}` : ''}`,
        evidence: f.upgradeEvidence ?? {
          source: 'EIP-1967',
          block: f.blockNumber,
        },
        severity: 'info',
      };
    }
  }

  return skipped(
    'implementation_hash',
    'Implementation / code hash',
    expectedImpl ?? (expectedHash || 'Not declared'),
    f.implementation
      ? `${f.implementation} · ${formatCodeHash(f.implementationCodeHash)}`
      : formatCodeHash(f.codeHash),
    {
      source: 'EIP-1967 / extcodehash',
      block: f.blockNumber,
      note: 'Partial evidence recorded; full comparison needs expected implementation or code hash in the manifest.',
    },
    'Declare expected implementation address or code hash for a hard match. Until then this comparison is out of scope.',
    'out_of_scope',
  );
}

function checkAddressSanity(m: ManifestFields, f: ObservedFacts): CheckResult {
  const flags = [...f.addressSanityFlags];
  const policyAddrs = [
    m.owner,
    m.expectedSafe,
    m.expectedDeployer,
    m.expectedProxyAdminOrUpgradeAuthority,
    m.expectedImplementation,
    m.treasury,
    m.feeRecipient,
    m.oracle,
  ];
  for (const a of policyAddrs) {
    const n = normalizeAddress(a);
    if (n && isZeroOrPlaceholder(n)) {
      flags.push(`manifest_placeholder:${n}`);
    }
  }

  // Harden: upgradeable policy with zero implementation onchain
  if (m.upgradeable && f.implementation && isZeroOrPlaceholder(f.implementation)) {
    flags.push('implementation_is_zero_or_dead');
  }

  // Manifest network vs observed
  const expectedChain = m.network === 'mainnet' ? 196 : 1952;
  if (f.chainId !== expectedChain) {
    flags.push('chain_mismatch');
  }

  if (!f.hasCode) {
    flags.push('no_code');
  }

  // Harden: contract address itself must not be zero
  if (isZeroOrPlaceholder(f.contractAddress)) {
    flags.push('contract_is_zero_or_dead');
  }

  const unique = [...new Set(flags)];
  if (unique.length === 0) {
    return {
      id: 'address_sanity',
      checkKey: 'address_sanity',
      status: 'matched',
      title: 'Address and chain sanity',
      expected: 'No zero/placeholder/chain mismatch',
      actual: 'No sanity flags raised',
      evidence: {
        source: 'address heuristics + getCode + chainId',
        block: f.blockNumber,
        raw: `chainId=${f.chainId}`,
      },
      severity: 'info',
    };
  }

  return {
    id: 'address_sanity',
    checkKey: 'address_sanity',
    status: 'blocked',
    title: 'Address and chain sanity',
    expected: 'Valid non-placeholder addresses on the declared X Layer network',
    actual: unique.join(', '),
    evidence: {
      source: 'address heuristics + getCode + chainId',
      block: f.blockNumber,
      raw: unique.join(' | '),
    },
    why: 'Zero address, placeholder, missing code, or chain mismatch blocks a trustworthy launch verification.',
    remediation: 'Replace placeholders, confirm network, and ensure the contract is deployed at the given address.',
    severity: 'critical',
  };
}

function checkVerification(_m: ManifestFields, f: ObservedFacts): CheckResult {
  const v = f.verification;
  if (v.status === 'verified') {
    return {
      id: 'verification_status',
      checkKey: 'verification_status',
      status: 'matched',
      title: 'Source verification status recorded',
      expected: 'Verified source preferred',
      actual: `Verified via ${v.source ?? 'unknown'}${v.details ? ` (${v.details})` : ''}`,
      evidence: v.evidence,
      severity: 'info',
    };
  }
  if (v.status === 'unverified') {
    return {
      id: 'verification_status',
      checkKey: 'verification_status',
      status: 'review',
      title: 'Source verification status recorded',
      expected: 'Verified source preferred',
      actual: 'Not verified on Sourcify',
      evidence: v.evidence,
      why: 'Unverified source makes independent review harder. This does not alone prove a policy mismatch.',
      remediation: 'Verify the contract on the OKX explorer / Sourcify, then re-run.',
      severity: 'medium',
    };
  }
  return skipped(
    'verification_status',
    'Source verification status recorded',
    'Record verification status',
    v.details ?? 'Unknown',
    v.evidence,
    'Verification status could not be confirmed from available public APIs.',
    'evidence_missing',
    'info',
    `Check manually: ${v.explorerUrl ?? 'OKX explorer'}`,
  );
}

function checkInitializer(m: ManifestFields, f: ObservedFacts): CheckResult {
  if (!m.upgradeable) {
    return skipped(
      'initializer_sealed',
      'Initializer sealed',
      'N/A for non-upgradeable policy',
      f.initializerSealed === null
        ? 'Not probed as required'
        : `initialized version=${f.initializedVersion}`,
      f.initializerEvidence ?? {
        source: 'initializer probe',
        block: f.blockNumber,
      },
      'Initializer seal check is out of scope for a non-upgradeable policy.',
      'out_of_scope',
    );
  }

  if (f.initializerSealed === null) {
    return skipped(
      'initializer_sealed',
      'Initializer sealed',
      'Initialized once; cannot be reused',
      'Initializer state not readable',
      f.initializerEvidence ?? {
        source: 'initialized() / OZ storage',
        block: f.blockNumber,
        note: 'Pattern not detected — not fabricated as sealed.',
      },
      'Upgradeable policy requires a sealed initializer, but state could not be read. Manual review required.',
      'evidence_missing',
      'high',
      'Confirm Initializable storage on the explorer or re-run when the pattern is detectable.',
    );
  }

  if (!f.initializerSealed) {
    return {
      id: 'initializer_sealed',
      checkKey: 'initializer_sealed',
      status: 'blocked',
      title: 'Initializer sealed',
      expected: 'Initialized / sealed',
      actual: `version=${f.initializedVersion ?? 0} (not initialized)`,
      evidence: f.initializerEvidence ?? { source: 'initialized()', block: f.blockNumber },
      why: 'Uninitialized upgradeable contracts can be taken over by a hostile initializer.',
      remediation: 'Complete initialization and disable initializers per OpenZeppelin guidance.',
      severity: 'critical',
    };
  }

  return {
    id: 'initializer_sealed',
    checkKey: 'initializer_sealed',
    status: 'matched',
    title: 'Initializer sealed',
    expected: 'Initialized / sealed',
    actual: `version=${f.initializedVersion}`,
    evidence: f.initializerEvidence ?? { source: 'initialized()', block: f.blockNumber },
    severity: 'info',
  };
}

function checkOptionalAllowlists(m: ManifestFields, f: ObservedFacts, opts?: PolicyCheckOptions): CheckResult[] {
  const out: CheckResult[] = [];

  const pairs: {
    key: string;
    title: string;
    expected: string;
    actual: string | null;
    source: string;
    allowlist?: string;
  }[] = [
    {
      key: 'fee_recipient',
      title: 'Fee recipient',
      expected: m.feeRecipient,
      actual: f.feeRecipient,
      source: 'feeRecipient()',
    },
    {
      key: 'treasury',
      title: 'Treasury allowlist',
      expected: m.treasury,
      actual: f.treasury,
      source: 'treasury()',
    },
    {
      key: 'oracle',
      title: 'Oracle address',
      expected: m.oracle,
      actual: f.oracle,
      source: 'oracle()',
    },
    {
      key: 'router',
      title: 'Approved router',
      expected: parseAddressList(m.approvedRouters)[0] ?? m.approvedRouters,
      actual: f.router,
      source: 'router()',
      allowlist: m.approvedRouters,
    },
    {
      key: 'factory',
      title: 'Approved factory',
      expected: parseAddressList(m.approvedFactories)[0] ?? m.approvedFactories,
      actual: f.factory,
      source: 'factory()',
      allowlist: m.approvedFactories,
    },
    {
      key: 'pool',
      title: 'Approved pool',
      expected: parseAddressList(m.approvedPools)[0] ?? m.approvedPools,
      actual: f.pool,
      source: 'pool()',
      allowlist: m.approvedPools,
    },
  ];

  for (const p of pairs) {
    const exp = typeof p.expected === 'string' ? normalizeAddress(p.expected) : null;
    const hasPolicy = !isEmptyField(String(p.expected ?? ''));
    if (!hasPolicy && !p.actual) {
      out.push(
        skipped(
          p.key,
          p.title,
          'Not declared',
          `${p.source} not present or not readable`,
          {
            source: p.source,
            block: f.blockNumber,
            note: 'No policy value and no onchain value — nothing to compare.',
          },
          'Optional integration not in scope for this scan.',
          'out_of_scope',
        ),
      );
      continue;
    }
    if (hasPolicy && !p.actual) {
      out.push(
        skipped(
          p.key,
          p.title,
          String(exp ?? p.expected),
          `${p.source} not readable`,
          {
            source: p.source,
            block: f.blockNumber,
            note: 'Getter missing or reverted — not treated as a match.',
          },
          'Policy declares a value but the contract does not expose a readable getter.',
          'evidence_missing',
          'medium',
          'Confirm ABI/pattern or verify manually on explorer.',
        ),
      );
      continue;
    }
    if (!hasPolicy && p.actual) {
      if (undeclaredMode(opts) === 'out_of_scope') {
        out.push(
          skipped(
            p.key,
            p.title,
            'Not declared in manifest',
            p.actual,
            { source: p.source, block: f.blockNumber, raw: p.actual },
            'Observed but undeclared — out of scope per agent options.',
            'out_of_scope',
          ),
        );
      } else {
        out.push({
          id: p.key,
          checkKey: p.key,
          status: 'review',
          title: p.title,
          expected: 'Not declared in manifest',
          actual: p.actual,
          evidence: { source: p.source, block: f.blockNumber, raw: p.actual },
          why: 'Onchain value observed without a corresponding launch policy entry.',
          remediation: 'Add this address to the Launch Manifest if approved.',
          severity: 'medium',
        });
      }
      continue;
    }
    if (exp && p.actual) {
      const allow = p.allowlist ? parseAddressList(p.allowlist) : [];
      const match =
        allow.length > 0
          ? allow.some((a) => addressesEqual(a, p.actual))
          : addressesEqual(exp, p.actual);
      out.push({
        id: p.key,
        checkKey: p.key,
        status: match ? 'matched' : 'blocked',
        title: p.title,
        expected: allow.length ? allow.join(', ') : exp,
        actual: p.actual,
        evidence: { source: p.source, block: f.blockNumber, raw: p.actual },
        why: match ? undefined : `${p.title} does not match the approved policy value.`,
        remediation: match
          ? undefined
          : 'Update the onchain configuration or the approved allowlist after review.',
        severity: match ? 'info' : 'critical',
      });
    }
  }

  return out;
}

function checkTokenEconomics(m: ManifestFields, f: ObservedFacts): CheckResult[] {
  const out: CheckResult[] = [];

  // maxTokenSupply
  const maxSupplyDeclared = !isEmptyField(m.maxTokenSupply);
  if (!maxSupplyDeclared && f.totalSupply === null) {
    out.push(
      skipped(
        'max_token_supply',
        'Max token supply',
        'Not declared',
        'totalSupply() not present or not readable',
        { source: 'totalSupply()', block: f.blockNumber },
        'Supply comparison out of scope — nothing declared and no readable totalSupply.',
        'out_of_scope',
      ),
    );
  } else if (maxSupplyDeclared && f.totalSupply === null) {
    out.push(
      skipped(
        'max_token_supply',
        'Max token supply',
        m.maxTokenSupply,
        'totalSupply() not readable',
        { source: 'totalSupply()', block: f.blockNumber },
        'Policy declares max supply but totalSupply() could not be read.',
        'evidence_missing',
        'medium',
        'Confirm ERC-20 totalSupply is available, then re-run.',
      ),
    );
  } else if (!maxSupplyDeclared && f.totalSupply !== null) {
    out.push(
      skipped(
        'max_token_supply',
        'Max token supply',
        'Not declared',
        `totalSupply ${f.totalSupply}`,
        { source: 'totalSupply()', block: f.blockNumber, raw: f.totalSupply },
        'Onchain supply observed but max not declared — out of scope (declare maxTokenSupply to enforce).',
        'out_of_scope',
      ),
    );
  } else if (maxSupplyDeclared && f.totalSupply !== null) {
    try {
      const maxB = BigInt(m.maxTokenSupply.trim());
      const curB = BigInt(f.totalSupply);
      const ok = curB <= maxB;
      out.push({
        id: 'max_token_supply',
        checkKey: 'max_token_supply',
        status: ok ? 'matched' : 'blocked',
        title: 'Max token supply',
        expected: `totalSupply ≤ ${m.maxTokenSupply}`,
        actual: f.totalSupply,
        evidence: { source: 'totalSupply()', block: f.blockNumber, raw: f.totalSupply },
        why: ok ? undefined : 'Onchain totalSupply exceeds the max declared in policy.',
        remediation: ok ? undefined : 'Reduce supply or raise the approved max after review.',
        severity: ok ? 'info' : 'critical',
      });
    } catch {
      out.push({
        id: 'max_token_supply',
        checkKey: 'max_token_supply',
        status: 'review',
        title: 'Max token supply',
        expected: m.maxTokenSupply,
        actual: f.totalSupply,
        evidence: { source: 'totalSupply()', block: f.blockNumber, raw: f.totalSupply },
        why: 'Could not parse maxTokenSupply / totalSupply as integers for comparison.',
        remediation: 'Use integer base-unit strings (no decimals notation).',
        severity: 'medium',
      });
    }
  }

  // mintingAllowedAfterLaunch: null = out of scope
  if (m.mintingAllowedAfterLaunch === null || m.mintingAllowedAfterLaunch === undefined) {
    out.push(
      skipped(
        'minting_policy',
        'Minting after launch',
        'Not declared',
        f.minterHolders?.length
          ? `minter holders: ${f.minterHolders.join(', ')}`
          : 'no minter holders observed',
        {
          source: 'minter() / MINTER_ROLE',
          block: f.blockNumber,
          raw: f.minterHolders?.join(',') ?? 'none',
        },
        'Minting policy not declared — out of scope.',
        'out_of_scope',
      ),
    );
  } else if (m.mintingAllowedAfterLaunch === true) {
    out.push({
      id: 'minting_policy',
      checkKey: 'minting_policy',
      status: 'matched',
      title: 'Minting after launch',
      expected: 'Minting allowed after launch',
      actual: f.minterHolders?.length
        ? `minters observed: ${f.minterHolders.join(', ')}`
        : 'no minter holders observed (still allowed by policy)',
      evidence: {
        source: 'minter() / MINTER_ROLE',
        block: f.blockNumber,
        raw: f.minterHolders?.join(',') ?? 'none',
      },
      severity: 'info',
    });
  } else {
    // false — minting must not be enabled
    if (f.minterHolders && f.minterHolders.length > 0) {
      out.push({
        id: 'minting_policy',
        checkKey: 'minting_policy',
        status: 'blocked',
        title: 'Minting after launch',
        expected: 'Minting not allowed after launch',
        actual: `minter holders: ${f.minterHolders.join(', ')}`,
        evidence: {
          source: 'minter() / MINTER_ROLE',
          block: f.blockNumber,
          raw: f.minterHolders.join(','),
        },
        why: 'Policy forbids post-launch minting but minter privileges were observed.',
        remediation: 'Revoke MINTER_ROLE / minter() or update policy if minting is intentional.',
        severity: 'critical',
      });
    } else if (f.minterHolders === null) {
      // no evidence either way — if we never probed successfully, evidence_missing only when AC might exist is hard; treat as matched soft
      out.push(
        skipped(
          'minting_policy',
          'Minting after launch',
          'Minting not allowed after launch',
          'No minter() / MINTER_ROLE holders observed (probe incomplete or absent)',
          {
            source: 'minter() / MINTER_ROLE',
            block: f.blockNumber,
            note: 'No minter holders found via optional getters / role probe.',
          },
          'Policy forbids minting; no minter holders were observed. Not a proof that minting is impossible via other patterns.',
          'out_of_scope',
          'medium',
        ),
      );
    } else {
      out.push({
        id: 'minting_policy',
        checkKey: 'minting_policy',
        status: 'matched',
        title: 'Minting after launch',
        expected: 'Minting not allowed after launch',
        actual: 'No minter holders observed',
        evidence: {
          source: 'minter() / MINTER_ROLE',
          block: f.blockNumber,
          raw: 'none',
        },
        severity: 'info',
      });
    }
  }

  return out;
}

function checkOracleStaleness(m: ManifestFields, f: ObservedFacts): CheckResult {
  const maxStale = m.maxOracleStalenessSec;
  const hasPolicy = maxStale !== null && maxStale !== undefined;
  if (!hasPolicy && f.oracleUpdatedAt === null) {
    return skipped(
      'oracle_staleness',
      'Oracle staleness',
      'Not declared',
      'No maxOracleStalenessSec; no updatedAt observed',
      { source: 'latestRoundData / policy', block: f.blockNumber },
      'Oracle staleness out of scope.',
      'out_of_scope',
    );
  }

  if (hasPolicy && f.oracleUpdatedAt === null) {
    return skipped(
      'oracle_staleness',
      'Oracle staleness',
      `updatedAt within ${maxStale}s of block time`,
      f.oracle
        ? 'oracle set but latestRoundData.updatedAt unreadable'
        : 'no oracle address to read',
      {
        source: 'oracle.latestRoundData()',
        block: f.blockNumber,
        note: f.oracle ?? undefined,
      },
      'Policy requires oracle freshness but updatedAt could not be read.',
      'evidence_missing',
      'medium',
      'Point oracle at a Chainlink-style feed exposing latestRoundData, then re-run.',
    );
  }

  if (!hasPolicy && f.oracleUpdatedAt !== null) {
    return skipped(
      'oracle_staleness',
      'Oracle staleness',
      'Not declared',
      `updatedAt ${f.oracleUpdatedAt}`,
      {
        source: 'oracle.latestRoundData()',
        block: f.blockNumber,
        raw: String(f.oracleUpdatedAt),
      },
      'Oracle timestamp observed without maxOracleStalenessSec — out of scope.',
      'out_of_scope',
    );
  }

  // both present
  const age = f.timestamp - (f.oracleUpdatedAt as number);
  const ok = age <= (maxStale as number) && age >= 0;
  return {
    id: 'oracle_staleness',
    checkKey: 'oracle_staleness',
    status: ok ? 'matched' : 'blocked',
    title: 'Oracle staleness',
    expected: `age ≤ ${maxStale}s`,
    actual: `age ${age}s (updatedAt ${f.oracleUpdatedAt}, blockTime ${f.timestamp})`,
    evidence: {
      source: 'oracle.latestRoundData() + block.timestamp',
      block: f.blockNumber,
      raw: `updatedAt=${f.oracleUpdatedAt}, age=${age}`,
    },
    why: ok ? undefined : 'Oracle update is older than the maximum allowed staleness.',
    remediation: ok ? undefined : 'Refresh the oracle or relax maxOracleStalenessSec after review.',
    severity: ok ? 'info' : 'critical',
  };
}

function checkFeeBps(m: ManifestFields, f: ObservedFacts): CheckResult {
  if (m.maxFeeBps === null || m.maxFeeBps === undefined) {
    if (f.feeBps === null) {
      return skipped(
        'max_fee_bps',
        'Max fee (bps)',
        'Not declared',
        'feeBps/fee not readable',
        { source: 'feeBps()/fee()', block: f.blockNumber },
        'Fee bps out of scope.',
        'out_of_scope',
      );
    }
    return skipped(
      'max_fee_bps',
      'Max fee (bps)',
      'Not declared',
      `onchain ${f.feeBps}`,
      { source: 'feeBps()/fee()', block: f.blockNumber, raw: String(f.feeBps) },
      'Onchain fee observed without maxFeeBps — out of scope.',
      'out_of_scope',
    );
  }
  if (f.feeBps === null) {
    return skipped(
      'max_fee_bps',
      'Max fee (bps)',
      `fee ≤ ${m.maxFeeBps} bps`,
      'feeBps/fee not readable',
      { source: 'feeBps()/fee()', block: f.blockNumber },
      'Policy declares maxFeeBps but fee could not be read.',
      'evidence_missing',
      'medium',
    );
  }
  // Heuristic: if onchain value looks like 1e6 fee units, don't false-block — review
  if (f.feeBps > 10_000 && m.maxFeeBps <= 10_000) {
    return {
      id: 'max_fee_bps',
      checkKey: 'max_fee_bps',
      status: 'review',
      title: 'Max fee (bps)',
      expected: `≤ ${m.maxFeeBps} bps`,
      actual: String(f.feeBps),
      evidence: { source: 'feeBps()/fee()', block: f.blockNumber, raw: String(f.feeBps) },
      why: 'Onchain fee scale may not be basis points (value > 10000). Manual comparison required.',
      remediation: 'Confirm fee units (bps vs 1e6) and re-declare maxFeeBps accordingly.',
      severity: 'medium',
    };
  }
  const ok = f.feeBps <= m.maxFeeBps;
  return {
    id: 'max_fee_bps',
    checkKey: 'max_fee_bps',
    status: ok ? 'matched' : 'blocked',
    title: 'Max fee (bps)',
    expected: `≤ ${m.maxFeeBps} bps`,
    actual: String(f.feeBps),
    evidence: { source: 'feeBps()/fee()', block: f.blockNumber, raw: String(f.feeBps) },
    why: ok ? undefined : 'Onchain fee exceeds maxFeeBps.',
    remediation: ok ? undefined : 'Lower fee or raise approved max after review.',
    severity: ok ? 'info' : 'critical',
  };
}

function checkSlippageBps(m: ManifestFields, f: ObservedFacts): CheckResult {
  if (m.maxSlippageBps === null || m.maxSlippageBps === undefined) {
    return skipped(
      'max_slippage_bps',
      'Max slippage (bps)',
      'Not declared',
      f.slippageBps === null ? 'maxSlippageBps() not readable' : String(f.slippageBps),
      { source: 'maxSlippageBps()', block: f.blockNumber },
      'Slippage policy out of scope.',
      'out_of_scope',
    );
  }
  if (f.slippageBps === null) {
    return skipped(
      'max_slippage_bps',
      'Max slippage (bps)',
      `≤ ${m.maxSlippageBps} bps`,
      'maxSlippageBps() not readable',
      { source: 'maxSlippageBps()', block: f.blockNumber },
      'Policy declares maxSlippageBps but getter unreadable.',
      'evidence_missing',
      'medium',
    );
  }
  const ok = f.slippageBps <= m.maxSlippageBps;
  return {
    id: 'max_slippage_bps',
    checkKey: 'max_slippage_bps',
    status: ok ? 'matched' : 'blocked',
    title: 'Max slippage (bps)',
    expected: `≤ ${m.maxSlippageBps} bps`,
    actual: String(f.slippageBps),
    evidence: { source: 'maxSlippageBps()', block: f.blockNumber, raw: String(f.slippageBps) },
    why: ok ? undefined : 'Onchain max slippage exceeds policy.',
    remediation: ok ? undefined : 'Tighten onchain slippage or update policy after review.',
    severity: ok ? 'info' : 'critical',
  };
}

function checkPendingOwner(m: ManifestFields, f: ObservedFacts): CheckResult {
  if (!f.pendingOwner) {
    return skipped(
      'pending_owner',
      'Pending ownership transfer',
      'No pending owner',
      'pendingOwner() empty or not Ownable2Step',
      { source: 'pendingOwner()', block: f.blockNumber },
      'No pending ownership transfer observed.',
      'out_of_scope',
    );
  }
  const expected = normalizeAddress(m.owner) ?? normalizeAddress(m.expectedSafe);
  const pendingIsExpected = expected && addressesEqual(expected, f.pendingOwner);
  return {
    id: 'pending_owner',
    checkKey: 'pending_owner',
    status: 'review',
    title: 'Pending ownership transfer',
    expected: expected ? `Stable owner ${expected}` : 'No in-flight ownership transfer',
    actual: `pendingOwner ${f.pendingOwner}${pendingIsExpected ? ' (matches declared owner)' : ''}`,
    evidence: {
      source: 'pendingOwner()',
      block: f.blockNumber,
      raw: f.pendingOwner,
    },
    why: 'Ownable2Step pending owner is set — ownership transfer may be in flight.',
    remediation: 'Accept/cancel the transfer or wait until pendingOwner is cleared, then re-verify.',
    severity: 'high',
  };
}

function checkOraclePair(m: ManifestFields, f: ObservedFacts): CheckResult {
  // Soft: no standard onchain pair reader — declare only for documentation
  if (isEmptyField(m.oraclePair)) {
    return skipped(
      'oracle_pair',
      'Oracle pair label',
      'Not declared',
      'N/A',
      { source: 'policy', block: f.blockNumber },
      'Oracle pair is a documentation field (no standard onchain getter).',
      'out_of_scope',
    );
  }
  return {
    id: 'oracle_pair',
    checkKey: 'oracle_pair',
    status: 'matched',
    title: 'Oracle pair label',
    expected: m.oraclePair,
    actual: `Declared ${m.oraclePair} (label only; not verified onchain)`,
    evidence: {
      source: 'policy',
      block: f.blockNumber,
      note: 'Pair label is not cross-checked onchain — informational match.',
    },
    severity: 'info',
  };
}

function checkAccessControlRoles(m: ManifestFields, f: ObservedFacts): CheckResult[] {
  if (f.roles.length === 0) {
    return [];
  }

  const results: CheckResult[] = [];

  // Note: this is a limited probe (common roles vs known addresses only).
  for (const ro of f.roles) {
    const holdersStr = ro.holders.join(', ');
    const expected = m.owner || m.expectedSafe || '—';
    const isOnlyOwner = ro.holders.length === 1 && addressesEqual(ro.holders[0], expected);

    const evidenceNote = ro.evidence.note
      ? ro.evidence.note
      : 'Limited probe: common roles checked only against known privileged addresses (owner, proxy admin, etc.). Full role member enumeration (events / getRoleMember) not performed.';

    if (isOnlyOwner) {
      results.push({
        id: `role_${ro.role}`,
        checkKey: `role_${ro.role.toLowerCase()}`,
        status: 'matched',
        title: `Role ${ro.role} (limited check)`,
        expected: expected,
        actual: holdersStr,
        evidence: { ...ro.evidence, note: evidenceNote },
        severity: 'info',
      });
    } else {
      results.push({
        id: `role_${ro.role}`,
        checkKey: `role_${ro.role.toLowerCase()}`,
        status: 'review',
        title: `Privileged role observed: ${ro.role} (limited check)`,
        expected: 'Accounted for in launch policy or intentionally absent',
        actual: `${ro.role} held by ${holdersStr}`,
        evidence: { ...ro.evidence, note: evidenceNote },
        why: 'A privileged role was detected on a known address via AccessControl. This probe only checks common roles against owner/admin/etc.; it does not discover every possible holder.',
        remediation: 'Declare these roles explicitly in policy, verify they are intended, or revoke unnecessary privileges.',
        severity: 'high',
      });
    }
  }

  return results;
}

export function runPolicyChecks(
  manifest: ManifestFields,
  facts: ObservedFacts,
  opts?: PolicyCheckOptions,
): { results: CheckResult[]; verdict: Verdict; coverage: Coverage } {
  const results: CheckResult[] = [
    checkChainAndDeployer(manifest, facts, opts),
    checkOwner(manifest, facts, opts),
    checkPendingOwner(manifest, facts),
    checkUpgradeAuthority(manifest, facts),
    checkTimelock(manifest, facts),
    checkImplementation(manifest, facts),
    checkInitializer(manifest, facts),
    checkAddressSanity(manifest, facts),
    checkVerification(manifest, facts),
    ...checkOptionalAllowlists(manifest, facts, opts),
    ...checkTokenEconomics(manifest, facts),
    checkOracleStaleness(manifest, facts),
    checkOraclePair(manifest, facts),
    checkFeeBps(manifest, facts),
    checkSlippageBps(manifest, facts),
    ...checkAccessControlRoles(manifest, facts),
  ];

  // If no code, force blocked already via sanity/owner — keep results honest
  const verdict = verdictOf(results);
  const coverage = coverageOf(results);
  return { results, verdict, coverage };
}

export function buildScanRun(
  manifest: ManifestFields,
  facts: ObservedFacts,
  startedAt: string,
  manifestVersion: number,
): ScanRun {
  const finishedAt = new Date().toISOString();
  const { results, verdict, coverage } = runPolicyChecks(manifest, facts);
  return {
    id: `scan_${facts.blockNumber}_${Date.now()}`,
    startedAt,
    finishedAt,
    network: facts.network,
    contractAddress: facts.contractAddress,
    manifest: { ...manifest },
    manifestVersion,
    facts,
    results,
    verdict,
    coverage,
  };
}
