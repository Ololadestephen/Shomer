import type {
  FieldProvenanceMap,
  ManifestFieldKey,
  ManifestFields,
  ObservedFacts,
  PolicyState,
} from './types';
import {
  isPlaceholderProjectName,
  suggestedProjectName,
} from '../utils/tokenLabel';
import { emptyManifest, emptyProvenance } from './types';

/**
 * Build an editable draft from live ObservedFacts.
 *
 * CRITICAL: This never approves a manifest and never implies Policy Matched.
 * Imported values are only a draft for founder review.
 */
export function draftFieldsFromFacts(
  facts: ObservedFacts,
  existing: ManifestFields,
): { fields: ManifestFields; provenance: FieldProvenanceMap; importedKeys: ManifestFieldKey[] } {
  const fields = emptyManifest({
    ...existing,
    network: facts.network,
    contractAddress: facts.contractAddress,
  });

  const provenance: FieldProvenanceMap = { ...emptyProvenance() };
  const importedKeys: ManifestFieldKey[] = [];

  const set = (key: ManifestFieldKey, value: string | number | boolean | null) => {
    if (value === null || value === undefined || value === '') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fields as any)[key] = value;
    provenance[key] = 'imported';
    importedKeys.push(key);
  };

  if (facts.deployer) set('expectedDeployer', facts.deployer);

  if (facts.owner) {
    set('owner', facts.owner);
    if (facts.isSafe) {
      set('expectedSafe', facts.owner);
      if (facts.safeThreshold !== null) set('minMultisigThreshold', facts.safeThreshold);
    }
  }

  if (facts.isProxy) {
    set('upgradeable', true);
    if (facts.upgradeAuthority) {
      set('expectedProxyAdminOrUpgradeAuthority', facts.upgradeAuthority);
    }
    if (facts.implementation) set('expectedImplementation', facts.implementation);
    if (facts.implementationCodeHash) {
      set('expectedImplementationCodeHash', facts.implementationCodeHash);
    }
  } else if (facts.isProxy === false) {
    set('upgradeable', false);
  }

  if (facts.timelockMinDelaySec !== null) {
    set('timelockRequired', true);
    set('minTimelockDelaySec', facts.timelockMinDelaySec);
  }

  if (facts.treasury) set('treasury', facts.treasury);
  if (facts.feeRecipient) set('feeRecipient', facts.feeRecipient);
  if (facts.totalSupply) set('maxTokenSupply', facts.totalSupply);
  if (facts.oracle) set('oracle', facts.oracle);
  if (facts.router) set('approvedRouters', facts.router);

  // Preserve founder project name if set
  fields.projectName = existing.projectName;
  const label = suggestedProjectName(facts.tokenName, facts.tokenSymbol);
  if (label && isPlaceholderProjectName(fields.projectName)) {
    fields.projectName = label;
  }

  return { fields, provenance, importedKeys };
}

/** Apply live-state import onto policy draft only — never touches approved. */
export function applyLiveImportToDraft(
  state: PolicyState,
  facts: ObservedFacts,
): PolicyState {
  const { fields, provenance } = draftFieldsFromFacts(facts, state.draft);
  // Preserve founder provenance on keys founder already set (do not clobber with import)
  const mergedProvenance: FieldProvenanceMap = { ...provenance };
  for (const [k, v] of Object.entries(state.provenance) as [ManifestFieldKey, string][]) {
    if (v === 'founder') {
      // Keep founder value and provenance; do not overwrite that field from live
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fields as any)[k] = state.draft[k];
      mergedProvenance[k] = 'founder';
    }
  }

  return {
    ...state,
    draft: fields,
    provenance: mergedProvenance,
    lastImportBlock: facts.blockNumber,
    lastImportAt: new Date().toISOString(),
    // approved unchanged
  };
}

/** Mark a field as founder-set after manual edit. */
export function markFounderField(
  provenance: FieldProvenanceMap,
  key: ManifestFieldKey,
): FieldProvenanceMap {
  return { ...provenance, [key]: 'founder' };
}

/**
 * Freeze current draft as the next immutable approved version.
 * Does not run verification.
 */
export function approveDraft(state: PolicyState): PolicyState {
  const nextVersion = (state.approved?.version ?? 0) + 1;
  return {
    ...state,
    approved: {
      version: nextVersion,
      fields: { ...state.draft },
      approvedAt: new Date().toISOString(),
      sourceImportBlock: state.lastImportBlock,
    },
  };
}
