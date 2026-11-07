import { readFacts } from './lib/adapters/xlayer';
import { buildScanRun } from './lib/policy/engine';
import {
  applyLiveImportToDraft,
  approveDraft,
  markFounderField,
} from './lib/policy/importFromFacts';
import type {
  CheckResult,
  CheckStatus,
  FieldProvenance,
  ManifestFieldKey,
  ManifestFields,
  ObservedFacts,
  PolicyState,
  ScanRun,
} from './lib/policy/types';
import { emptyManifest, emptyPolicyState, IMPORTABLE_FIELD_KEYS } from './lib/policy/types';
import { getPolicyPack, seedDraftFromPack } from './lib/policy/packs';
import { diffManifestFields } from './lib/policy/diff';
import {
  clearAllShomerState,
  clearLastScan,
  loadLastFacts,
  loadLastScan,
  loadPolicyState,
  saveLastFacts,
  saveLastScan,
  savePolicyState,
} from './lib/storage';
import {
  checkStatusLabel,
  checkStatusTagClass,
  coveragePercent,
  formatTime,
  networkLabel,
  verdictEyebrowClass,
  verdictLabel,
  verdictPlainEnglish,
  verdictOrbClass,
} from './lib/ui/format';
import { normalizeAddress, shortAddress } from './lib/utils/address';
import {
  isPlaceholderProjectName,
  suggestedProjectName,
} from './lib/utils/tokenLabel';
import {
  resolveChain,
  getExplorerTxUrl,
  SHOMER_REGISTRY_ADDRESSES,
} from './lib/chain/chains';
import { shomerRegistryAbi } from './lib/contracts/registryAbi';
import {
  buildPublicReportSnapshot,
  computeReportHash,
  computeRecordId,
  verifyReportIntegrity,
  type ShomerPublicReport,
  type OnchainVerificationRecord,
} from './lib/report/reportSnapshot';
import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  type Address,
  type Hex,
} from 'viem';

let policy: PolicyState = loadPolicyState();
if (!policy.draft.network || policy.draft.network === 'mainnet' || policy.draft.network === 'testnet') {
  policy.draft.network = 'botchain-mainnet';
  savePolicyState(policy);
}
/** @deprecated use policy.draft — kept as alias for readability in forms */
let manifest: ManifestFields = policy.draft;
let lastScan: ScanRun | null = loadLastScan();
let lastFacts: ObservedFacts | null = loadLastFacts();
/** Filter for check list: status, or skip-reason subfilters. */
let checkFilter: CheckStatus | 'all' | 'out_of_scope' | 'evidence_missing' = 'all';

/** Public CipherBallot — reliable live-read demo on BOT Chain mainnet */
const SAMPLE_BOTCHAIN_CONTRACT = '0x1559C3a6B02E331307438D7839016EA5A827F467';
const SAMPLE_BOTCHAIN_PROJECT_NAME = 'CipherBallot Governance';


const FIELD_LABELS: Partial<Record<ManifestFieldKey, string>> = {
  expectedDeployer: 'Who should have deployed it',
  owner: 'Who should own it now',
  expectedSafe: 'Shared Safe / multisig address',
  minMultisigThreshold: 'Minimum signatures required',
  timelockRequired: 'Must wait before changes (timelock)',
  minTimelockDelaySec: 'Wait time in seconds',
  upgradeable: 'Can the code be upgraded later?',
  expectedProxyAdminOrUpgradeAuthority: 'Who may upgrade / admin the proxy',
  expectedImplementation: 'Implementation address we approved',
  expectedImplementationCodeHash: 'Code fingerprint (hash) we approved',
  treasury: 'Treasury wallet',
  feeRecipient: 'Who receives fees',
  maxTokenSupply: 'Max tokens allowed',
  mintingAllowedAfterLaunch: 'New minting allowed after launch',
  oracle: 'Price feed (oracle)',
  oraclePair: 'Pair label (notes)',
  maxOracleStalenessSec: 'Price feed max age (seconds)',
  approvedRouters: 'Allowed routers',
  approvedFactories: 'Allowed factories',
  approvedPools: 'Allowed pools',
  maxFeeBps: 'Max fee (basis points)',
  maxSlippageBps: 'Max slippage (basis points)',
};

// —— DOM helpers ——
const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

function toast(text: string) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

const PANEL_TITLES: Record<string, string> = {
  overview: 'Live',
  manifest: 'Your rules',
  scans: 'Results',
  reports: 'Brief',
};

function showPanel(id: string) {
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('is-visible', p.id === id);
  });
  document.querySelectorAll('.nav-item').forEach((n) => {
    const btn = n as HTMLElement;
    const on = btn.dataset.panel === id;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  const step = document.getElementById('topbarStep');
  if (step) step.textContent = PANEL_TITLES[id] ?? id;
  document.getElementById('appShell')?.setAttribute('data-active-panel', id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(id: string) {
  const d = document.getElementById(id) as HTMLDialogElement | null;
  d?.showModal();
  $('#modalBackdrop')?.classList.add('on');
}

function closeModals() {
  document.querySelectorAll('dialog[open]').forEach((d) =>
    (d as HTMLDialogElement).close(),
  );
  $('#modalBackdrop')?.classList.remove('on');
}

// —— Manifest form ——
function provenanceBadge(p: FieldProvenance | undefined): string {
  if (p === 'imported') {
    return `<span class="badge-prov badge-imported">FROM CHAIN</span>`;
  }
  if (p === 'founder') {
    return `<span class="badge-prov badge-founder">YOU SET</span>`;
  }
  return '';
}

function decorateManifestLabels() {
  const form = $('#manifestForm') as HTMLFormElement | null;
  if (!form) return;
  for (const key of IMPORTABLE_FIELD_KEYS) {
    const el = form.elements.namedItem(key as string) as HTMLInputElement | null;
    if (!el) continue;
    const label = el.closest('label');
    if (!label) continue;

    // Checkbox labels: append badge next to existing text, don't rebuild
    if (el.type === 'checkbox') {
      let slot = label.querySelector(`[data-prov-for="${key}"]`);
      if (!slot) {
        slot = document.createElement('span');
        slot.setAttribute('data-prov-for', key);
        label.appendChild(slot);
      }
      slot.innerHTML = provenanceBadge(policy.provenance[key]);
      continue;
    }

    let row = label.querySelector('.field-label-row');
    if (!row) {
      const text = FIELD_LABELS[key] || key;
      const input = el;
      label.textContent = '';
      row = document.createElement('div');
      row.className = 'field-label-row';
      row.innerHTML = `<span>${escapeHtml(text)}</span><span class="prov-slot" data-prov-for="${key}"></span>`;
      label.appendChild(row);
      label.appendChild(input);
      label.classList.add('field-wrap');
    }
    const slot = label.querySelector(`[data-prov-for="${key}"]`);
    if (slot) {
      slot.innerHTML = provenanceBadge(policy.provenance[key]);
    }
  }
}

function openMoreFieldsIfNeeded() {
  const details = document.getElementById('manifestMoreFields') as HTMLDetailsElement | null;
  if (!details) return;
  const d = policy.draft;
  const hasOptional =
    Boolean(d.treasury?.trim()) ||
    Boolean(d.feeRecipient?.trim()) ||
    Boolean(d.maxTokenSupply?.trim()) ||
    d.mintingAllowedAfterLaunch ||
    Boolean(d.oracle?.trim()) ||
    Boolean(d.oraclePair?.trim()) ||
    d.maxOracleStalenessSec !== null ||
    Boolean(d.approvedRouters?.trim()) ||
    Boolean(d.approvedFactories?.trim()) ||
    Boolean(d.approvedPools?.trim()) ||
    d.maxFeeBps !== null ||
    d.maxSlippageBps !== null;
  if (hasOptional) details.open = true;
}

function fillManifestForm() {
  manifest = policy.draft;
  const form = $('#manifestForm') as HTMLFormElement | null;
  if (!form) return;
  const set = (name: string, value: string | number | boolean | null) => {
    const el = form.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (!el) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = value === null || value === undefined ? '' : String(value);
    }
  };

  set('expectedDeployer', manifest.expectedDeployer);
  set('owner', manifest.owner);
  set('expectedSafe', manifest.expectedSafe);
  set('minMultisigThreshold', manifest.minMultisigThreshold);
  set('timelockRequired', manifest.timelockRequired);
  set('minTimelockDelaySec', manifest.minTimelockDelaySec);
  set('upgradeable', manifest.upgradeable);
  set(
    'expectedProxyAdminOrUpgradeAuthority',
    manifest.expectedProxyAdminOrUpgradeAuthority,
  );
  set('expectedImplementation', manifest.expectedImplementation);
  set('expectedImplementationCodeHash', manifest.expectedImplementationCodeHash);
  set('treasury', manifest.treasury);
  set('feeRecipient', manifest.feeRecipient);
  set('maxTokenSupply', manifest.maxTokenSupply);
  set('mintingAllowedAfterLaunch', manifest.mintingAllowedAfterLaunch);
  set('oracle', manifest.oracle);
  set('oraclePair', manifest.oraclePair);
  set('maxOracleStalenessSec', manifest.maxOracleStalenessSec);
  set('approvedRouters', manifest.approvedRouters);
  set('approvedFactories', manifest.approvedFactories);
  set('approvedPools', manifest.approvedPools);
  set('maxFeeBps', manifest.maxFeeBps);
  set('maxSlippageBps', manifest.maxSlippageBps);

  const pn = $('#fieldProjectName') as HTMLInputElement | null;
  const net = $('#fieldNetwork') as HTMLSelectElement | null;
  const ca = $('#fieldContract') as HTMLInputElement | null;
  if (pn) pn.value = manifest.projectName;
  if (net) net.value = manifest.network;
  if (ca) ca.value = manifest.contractAddress;
  updateNetworkLabel();
  decorateManifestLabels();
  openMoreFieldsIfNeeded();
  renderManifestStatus();
  updateLoopButtons();
}


function readNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function collectManifestFromForms(): ManifestFields {
  const form = $('#manifestForm') as HTMLFormElement;
  const g = (name: string) => {
    const el = form.elements.namedItem(name) as HTMLInputElement | null;
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return el.value.trim();
  };

  const projectName =
    ($('#fieldProjectName') as HTMLInputElement)?.value.trim() ||
    policy.draft.projectName;
  const network = (($('#fieldNetwork') as HTMLSelectElement)?.value ||
    policy.draft.network ||
    'botchain-mainnet') as any;
  const contractAddress =
    ($('#fieldContract') as HTMLInputElement)?.value.trim() ||
    policy.draft.contractAddress;

  return {
    ...emptyManifest(),
    projectName,
    network,
    contractAddress,
    expectedDeployer: String(g('expectedDeployer') || ''),
    owner: String(g('owner') || ''),
    expectedSafe: String(g('expectedSafe') || ''),
    minMultisigThreshold: readNum(String(g('minMultisigThreshold') || '')),
    timelockRequired: Boolean(g('timelockRequired')),
    minTimelockDelaySec: readNum(String(g('minTimelockDelaySec') || '')),
    upgradeable: Boolean(g('upgradeable')),
    expectedProxyAdminOrUpgradeAuthority: String(
      g('expectedProxyAdminOrUpgradeAuthority') || '',
    ),
    expectedImplementation: String(g('expectedImplementation') || ''),
    expectedImplementationCodeHash: String(
      g('expectedImplementationCodeHash') || '',
    ),
    treasury: String(g('treasury') || ''),
    feeRecipient: String(g('feeRecipient') || ''),
    maxTokenSupply: String(g('maxTokenSupply') || ''),
    mintingAllowedAfterLaunch: Boolean(g('mintingAllowedAfterLaunch')),
    oracle: String(g('oracle') || ''),
    oraclePair: String(g('oraclePair') || ''),
    maxOracleStalenessSec: readNum(String(g('maxOracleStalenessSec') || '')),
    approvedRouters: String(g('approvedRouters') || ''),
    approvedFactories: String(g('approvedFactories') || ''),
    approvedPools: String(g('approvedPools') || ''),
    maxFeeBps: readNum(String(g('maxFeeBps') || '')),
    maxSlippageBps: readNum(String(g('maxSlippageBps') || '')),
  };
}

function valuesEqual(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  if (a === null || a === undefined || a === '') {
    return b === null || b === undefined || b === '';
  }
  return String(a) === String(b);
}

/** Sync form → draft; mark edited fields as founder. Does not approve. */
function syncDraftFromForm(): void {
  const prev = policy.draft;
  const next = collectManifestFromForms();
  let provenance = { ...policy.provenance };
  for (const key of Object.keys(next) as ManifestFieldKey[]) {
    if (!valuesEqual(prev[key] as never, next[key] as never)) {
      // Any manual change is founder-owned (including clearing an import)
      if (key !== 'projectName' && key !== 'network' && key !== 'contractAddress') {
        provenance = markFounderField(provenance, key);
      }
    }
  }
  policy = {
    ...policy,
    draft: next,
    provenance,
  };
  manifest = policy.draft;
  savePolicyState(policy);
}

function persistManifest() {
  syncDraftFromForm();
  updateNetworkLabel();
  const crumb = $('#projectCrumb');
  if (crumb) crumb.textContent = policy.draft.projectName || 'New verification';
  fillManifestForm();
  toast('Saved your work-in-progress. Nothing is locked yet — use “Lock in” when ready.');
}

function fillDraftFromLive() {
  if (!lastFacts) {
    toast('Read what’s on chain first, then you can copy it into your rules');
    return;
  }
  syncDraftFromForm();
  policy = applyLiveImportToDraft(policy, lastFacts);
  // Keep network/address from verify form if present
  const net = ($('#fieldNetwork') as HTMLSelectElement)?.value;
  const ca = ($('#fieldContract') as HTMLInputElement)?.value.trim();
  if (net) policy.draft.network = net as any;
  if (ca) policy.draft.contractAddress = ca;
  if (lastFacts.contractAddress && !ca) {
    policy.draft.contractAddress = lastFacts.contractAddress;
  }
  manifest = policy.draft;
  savePolicyState(policy);
  fillManifestForm();
  toast(
    'Copied what we saw on chain into your rules. This is not locked and not a match yet — review, then Lock in.',
  );
  showPanel('manifest');
}

function approveManifestAction() {
  syncDraftFromForm();
  if (!normalizeAddress(policy.draft.contractAddress)) {
    toast('Add a contract address before you lock in rules');
    return;
  }
  const hasAnyPolicy =
    policy.draft.owner ||
    policy.draft.expectedSafe ||
    policy.draft.expectedProxyAdminOrUpgradeAuthority ||
    policy.draft.upgradeable ||
    policy.draft.timelockRequired ||
    policy.draft.expectedImplementation;
  if (!hasAnyPolicy) {
    toast('Your rules are almost empty. Add at least who owns it, or upgrade/timelock settings, before locking in.');
    return;
  }
  policy = approveDraft(policy);
  savePolicyState(policy);
  // Clear previous verification — must re-verify against new approved version
  lastScan = null;
  clearLastScanSafe();
  fillManifestForm();
  renderAll();
  toast(
    `Rules locked as v${policy.approved!.version}. Next: run Check to compare the live chain to this freeze.`,
  );
}

function clearLastScanSafe() {
  try {
    clearLastScan();
  } catch {
    /* ignore */
  }
}

/** Reset session: empty draft, no approved version (next approve = v1), clear facts/scan. */
function resetSession() {
  clearAllShomerState();
  policy = emptyPolicyState({
    draft: {
      ...emptyManifest(),
      network: 'botchain-mainnet',
    },
  });
  manifest = policy.draft;
  lastScan = null;
  lastFacts = null;
  fillManifestForm();
  const ca = $('#fieldContract') as HTMLInputElement | null;
  const pn = $('#fieldProjectName') as HTMLInputElement | null;
  if (ca) ca.value = '';
  if (pn) pn.value = '';
  renderAll();
  showPanel('overview');
  ca?.focus();
  toast('Reset — work cleared on BOT Chain. Next lock-in will be v1 again.');
}

function renderManifestStatus() {
  renderPolicyDiff();
  renderPolicyPackDesc();
  const packLiveBtn = document.getElementById('applyPackFromLive');
  if (packLiveBtn) {
    if (lastFacts) packLiveBtn.removeAttribute('hidden');
    else packLiveBtn.setAttribute('hidden', '');
  }
  const el = $('#manifestStatus');
  if (!el) return;
  const approved = policy.approved;
  const nextV = (approved?.version ?? 0) + 1;
  const label = document.getElementById('approveVersionLabel');
  if (label) label.textContent = `v${nextV}`;

  const draftNote =
    policy.lastImportBlock !== null
      ? `Your work-in-progress includes values copied from chain at block #${policy.lastImportBlock.toLocaleString()}.`
      : 'Work-in-progress only — we won’t use these rules for Check until you lock them in.';

  el.innerHTML = `
    <div class="status-row" style="margin:0">
      <span class="tag tag-review">WORK IN PROGRESS</span>
      ${
        approved
          ? `<span class="tag tag-pass">LOCKED v${approved.version}</span>`
          : `<span class="tag tag-skip">NOT LOCKED YET</span>`
      }
    </div>
    <p class="manifest-status-copy">${draftNote}
      ${
        approved
          ? ` Locked <strong>v${approved.version}</strong> · ${formatTime(approved.approvedAt)} is what Check will compare against.`
          : ' “Lock in” freezes this list so Check has a fixed target.'
      }
    </p>
  `;
}

function updateLoopButtons() {
  const hasFacts = Boolean(lastFacts);
  const hasApproved = Boolean(policy.approved);
  const ver = policy.approved?.version;
  const verLabel = ver ? `v${ver}` : 'v?';

  ['fillFromLive', 'fillFromLive2'].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    if (hasFacts) b.removeAttribute('hidden');
    else b.setAttribute('hidden', '');
  });

  const showVerify = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (hasApproved) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  };
  showVerify('verifyApproved');
  showVerify('verifyFromManifest');
  showVerify('runCheck2');

  const setVer = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = verLabel;
  };
  setVer('verifyApprovedLabel');
  setVer('verifyFromManifestLabel');
  setVer('runCheck2Label');

  // runCheck2 stays visible when approved; when not, hide so Checks panel doesn't imply verify works
  const run2 = document.getElementById('runCheck2');
  if (run2) {
    if (hasApproved) {
      run2.removeAttribute('hidden');
      run2.removeAttribute('disabled');
      run2.title = `Compare live state to approved ${verLabel} only`;
    } else {
      run2.setAttribute('hidden', '');
    }
  }
}

function updateEmptyState() {
  const title = $('#emptyTitle');
  const body = $('#emptyBody');
  if (!title || !body) return;

  if (policy.approved && !lastScan) {
    title.textContent = `Rules v${policy.approved.version} locked — next: Check`;
    body.innerHTML = `Run <strong>Check against v${policy.approved.version}</strong> to see if the live chain still matches what you locked.`;
  } else if (lastFacts && !policy.approved) {
    title.textContent = 'We saw the chain — now write your rules';
    body.innerHTML = `Open <strong>Your rules</strong>. You can copy from chain, edit, then <strong>Lock in</strong>. We only give a match/block after you lock and Check.`;
  } else {
    title.textContent = 'Start with a contract';
    body.innerHTML = `Enter a BOT Chain address above and <strong>Read what’s on chain</strong>.`;
  }
}

/** Hero “Verify a contract” → scroll to address form (single story). */
function scrollToVerifyForm() {
  const form = document.getElementById('verify-form');
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    (document.getElementById('landingContract') as HTMLInputElement | null)?.focus();
  }, 450);
}

/** Hub: cycle which check card is in focus (one sharp at a time). */
function initHubFocusCycle() {
  const root = document.getElementById('hubCards');
  if (!root) return;
  const cards = [...root.querySelectorAll<HTMLElement>('.hub-card')];
  if (cards.length === 0) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;

  let i = cards.findIndex((c) => c.classList.contains('focus'));
  if (i < 0) i = 0;

  const apply = (idx: number) => {
    cards.forEach((card, j) => {
      const on = j === idx;
      card.classList.toggle('focus', on);
      card.classList.toggle('dim', !on);
      const tag = card.querySelector('.hub-tag');
      if (tag) {
        const label = card.dataset.label || tag.textContent || '';
        tag.textContent = on ? 'In focus' : label;
        tag.classList.toggle('tag-focus', on);
      }
    });
  };

  apply(i);
  window.setInterval(() => {
    i = (i + 1) % cards.length;
    apply(i);
  }, 2800);
}

function updateNetworkLabel() {
  document.querySelectorAll('.network-label').forEach((el) => {
    const node = el as HTMLElement;
    node.textContent = node.closest('.topbar-network') ? 'BOT Chain' : 'BOT Chain Mainnet';
  });
}

// —— Render ——
function renderAll() {
  const crumb = $('#projectCrumb');
  if (crumb) {
    crumb.textContent =
      lastScan?.manifest.projectName ||
      policy.draft.projectName ||
      'New verification';
  }

  updateLoopButtons();
  updateEmptyState();
  renderManifestStatus();
  renderLoopBanner();

  // Live facts without verification: show privilege map only
  if (!lastScan && lastFacts) {
    $('#emptyState')?.setAttribute('hidden', '');
    $('#verdictCard')?.setAttribute('hidden', '');
    $('#overviewFindings')?.removeAttribute('hidden');
    renderLiveOnlyState(lastFacts);
    renderChecksEmpty();
    renderReportEmpty();
    return;
  }

  if (!lastScan) {
    $('#verdictCard')?.setAttribute('hidden', '');
    $('#overviewFindings')?.setAttribute('hidden', '');
    $('#emptyState')?.removeAttribute('hidden');
    renderChecksEmpty();
    renderReportEmpty();
    return;
  }

  $('#emptyState')?.setAttribute('hidden', '');
  $('#verdictCard')?.removeAttribute('hidden');
  $('#overviewFindings')?.removeAttribute('hidden');
  renderVerdict(lastScan);
  renderFindings(lastScan);
  renderProject(lastScan);
  renderPrivilegeMap(lastScan.facts);
  renderChecks(lastScan);
  renderReport(lastScan);
}

function renderLoopBanner() {
  const banner = document.getElementById('loopBanner');
  if (banner) {
    if (lastScan) {
      banner.innerHTML = `Last check: <strong>${verdictLabel(lastScan.verdict)}</strong> vs locked rules v${lastScan.manifestVersion}. Open Results or Brief.`;
    } else if (policy.approved) {
      banner.innerHTML = `Rules <strong>v${policy.approved.version}</strong> are locked. Next: <strong>Check against v${policy.approved.version}</strong>.`;
    } else if (lastFacts) {
      banner.innerHTML = `We read the chain at block #${lastFacts.blockNumber.toLocaleString()}. Next: open <strong>Your rules</strong>, review, then <strong>Lock in</strong>.`;
    } else {
      banner.textContent = 'Paste a contract → read live → draft policy → approve → compare.';
    }
  }

  // Compact chips: Live → Draft → Approve → Verify
  const chips = document.getElementById('loopChips');
  if (!chips) return;
  const live = Boolean(lastFacts || lastScan);
  const draft =
    live ||
    Boolean(
      policy.draft.owner ||
        policy.draft.expectedSafe ||
        policy.draft.upgradeable ||
        policy.lastImportBlock !== null,
    );
  const approved = Boolean(policy.approved);
  const verified = Boolean(lastScan);

  const setChip = (step: string, done: boolean, now: boolean) => {
    const el = chips.querySelector(`[data-step="${step}"]`);
    if (!el) return;
    el.classList.toggle('done', done);
    el.classList.toggle('now', now && !done);
  };

  setChip('live', live, !live);
  setChip('draft', draft && (approved || verified || live), live && !approved && !verified);
  setChip('approve', approved || verified, draft && !approved && !verified);
  setChip('verify', verified, approved && !verified);
}

function renderLiveOnlyState(facts: ObservedFacts) {
  const list = $('#findingsList');
  if (list) {
    const deployerLine = facts.deployer
      ? `Deployer ${shortAddress(facts.deployer, 4)}`
      : 'Deployer not observed';
    list.innerHTML = `
      <div class="finding review">
        <div class="finding-icon">i</div>
        <div class="finding-main">
          <div class="finding-name">
            <strong>Live state loaded</strong>
            <span class="tag tag-review">NO VERDICT YET</span>
          </div>
          <p>
            Block #${facts.blockNumber.toLocaleString()} · ${deployerLine}.
            Next: fill policy → approve → verify.
          </p>
          <div class="live-next-actions">
            <button class="button small primary" type="button" id="liveFillCta">Fill draft</button>
            <button class="button small ghost" type="button" id="liveManifestCta">Open policy</button>
          </div>
        </div>
      </div>`;
    list.querySelector('#liveFillCta')?.addEventListener('click', fillDraftFromLive);
    list.querySelector('#liveManifestCta')?.addEventListener('click', () => showPanel('manifest'));
  }
  const name = $('#projectNameDisplay');
  const badge = $('#projectNetworkBadge');
  const contract = $('#projectContract');
  const block = $('#projectBlock');
  const code = $('#projectCode');
  if (name) name.textContent = policy.draft.projectName || 'Live read';
  if (badge)
    badge.innerHTML = '<i></i> BOT CHAIN MAINNET';
  if (contract) contract.textContent = shortAddress(facts.contractAddress, 4);
  if (block) block.textContent = `#${facts.blockNumber.toLocaleString()}`;
  if (code)
    code.textContent = facts.hasCode
      ? shortAddress(facts.codeHash ?? '—', 4)
      : 'No code';
  renderPrivilegeMap(facts);
}

function renderVerdict(scan: ScanRun) {
  const orb = $('#verdictOrb');
  const meta = $('#verdictMeta');
  const title = $('#verdictTitle');
  const sub = $('#verdictSub');
  const summary = $('#verdictSummary');
  const scanMeta = $('#scanMeta');

  orb?.classList.remove('blocked', 'review', 'pass');
  orb?.classList.add(verdictOrbClass(scan.verdict));

  if (meta) {
    meta.className = `eyebrow ${verdictEyebrowClass(scan.verdict)}`;
    meta.textContent = `LOCKED RULES v${scan.manifestVersion} · ${formatTime(scan.finishedAt)}`;
  }
  if (title) title.textContent = verdictLabel(scan.verdict);

  const missing = scan.coverage.evidenceMissing ?? 0;
  const outOfScope = scan.coverage.outOfScope ?? 0;
  const attention =
    scan.coverage.blocked + scan.coverage.review + missing;
  if (sub) {
    const plain = verdictPlainEnglish(scan.verdict);
    if (scan.verdict === 'policy_matched') {
      sub.textContent = `${plain} Compared to locked v${scan.manifestVersion}${
        outOfScope ? ` · ${outOfScope} rule(s) left blank (not checked)` : ''
      }.`;
    } else if (scan.verdict === 'blocked') {
      sub.textContent = `${plain} ${scan.coverage.blocked} hard mismatch(es) vs locked v${scan.manifestVersion}.`;
    } else {
      sub.textContent = `${plain} ${attention} item(s) need a look (${scan.coverage.review} review · ${missing} couldn’t read) vs locked v${scan.manifestVersion}.`;
    }
  }

  if (summary) {
    const pct = coveragePercent(scan.coverage);
    summary.innerHTML = `
      <div><span class="num blocked-num">${scan.coverage.blocked}</span><span>Blocker</span></div>
      <div><span class="num review-num">${scan.coverage.review}</span><span>Review</span></div>
      <div><span class="num pass-num">${scan.coverage.matched}</span><span>Matched</span></div>
      <div><span class="num">${outOfScope}</span><span>Out of scope</span></div>
      <div><span class="num review-num">${missing}</span><span>Evidence missing</span></div>
      <div class="score"><span>Policy coverage</span><strong>${pct}<span>%</span></strong></div>
    `;
  }

  if (scanMeta) {
    const explorer = scan.facts.verification.explorerUrl;
    scanMeta.innerHTML = `
      <span><i class="chain-dot"></i> ${networkLabel(scan.network)}</span>
      <span>Approved <strong>v${scan.manifestVersion}</strong></span>
      <span>Block ${
        explorer
          ? `<a href="${explorer}" target="_blank" rel="noreferrer">#${scan.facts.blockNumber.toLocaleString()} ↗</a>`
          : `#${scan.facts.blockNumber.toLocaleString()}`
      }</span>
      <span>${shortAddress(scan.contractAddress, 4)}</span>
      <span class="mono">chain ${scan.facts.chainId}</span>
    `;
  }
}

function renderFindings(scan: ScanRun) {
  const list = $('#findingsList');
  if (!list) return;
  const priority = scan.results.filter(
    (r) =>
      r.status === 'blocked' ||
      r.status === 'review' ||
      (r.status === 'skipped' && r.skipReason === 'evidence_missing'),
  );
  const matched = scan.results.filter((r) => r.status === 'matched').length;
  const outOfScope = scan.results.filter(
    (r) => r.status === 'skipped' && r.skipReason === 'out_of_scope',
  ).length;

  const rows = priority
    .map(
      (r) => `
    <div class="finding ${r.status}${r.skipReason === 'evidence_missing' ? ' missing' : ''}" data-check-id="${r.id}">
      <div class="finding-icon">${r.status === 'skipped' ? '?' : '!'}</div>
      <div class="finding-main">
        <div class="finding-name">
          <strong>${escapeHtml(r.title)}</strong>
          <span class="tag ${checkStatusTagClass(r)}">${checkStatusLabel(r)}</span>
        </div>
        <p>${escapeHtml(r.why || r.actual)}</p>
        <button class="evidence-link" type="button" data-check-id="${r.id}">View evidence <span>→</span></button>
      </div>
      <div class="finding-value">
        <label>ACTUAL</label>
        <code>${escapeHtml(shorten(r.actual))}</code>
      </div>
    </div>`,
    )
    .join('');

  const matchedRow =
    matched > 0
      ? `<div class="finding pass brief-pass">
          <div class="finding-icon">✓</div>
          <div class="finding-main">
            <div class="finding-name">
              <strong>${matched} policies matched onchain</strong>
              <span class="tag tag-pass">MATCHED</span>
            </div>
            <p>Against approved v${scan.manifestVersion}: declared fields that were readable and agreed with the snapshot.</p>
          </div>
          <button class="text-btn" data-panel-target="scans" type="button">See checks <span>→</span></button>
        </div>`
      : '';

  const scopeRow =
    outOfScope > 0
      ? `<div class="finding skipped">
          <div class="finding-icon">–</div>
          <div class="finding-main">
            <div class="finding-name">
              <strong>${outOfScope} out of scope</strong>
              <span class="tag tag-skip-scope">OUT OF SCOPE</span>
            </div>
            <p>Undeclared, optional, or N/A for this policy — not treated as a match or a failure.</p>
          </div>
        </div>`
      : '';

  // Evidence-missing items already listed in priority; only show summary if none were expanded as rows
  // (they are in priority, so skip duplicate summary unless we want a collapsible note — omit)

  list.innerHTML =
    rows +
    matchedRow +
    scopeRow ||
    `<p class="muted-center">No findings to highlight.</p>`;
}

function renderProject(scan: ScanRun) {
  const name = $('#projectNameDisplay');
  const badge = $('#projectNetworkBadge');
  const contract = $('#projectContract');
  const block = $('#projectBlock');
  const code = $('#projectCode');
  if (name) name.textContent = scan.manifest.projectName || 'Unnamed project';
  if (badge)
    badge.innerHTML = '<i></i> BOT CHAIN MAINNET';
  if (contract) contract.textContent = shortAddress(scan.contractAddress, 4);
  if (block) block.textContent = `#${scan.facts.blockNumber.toLocaleString()}`;
  if (code)
    code.textContent = scan.facts.hasCode
      ? shortAddress(scan.facts.codeHash ?? '—', 4)
      : 'No code';

  const copyBtn = $('#copyContract');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard?.writeText(scan.contractAddress);
      toast('Contract address copied');
    };
  }
}

function renderPrivilegeMap(f: ObservedFacts) {
  const el = $('#privilegeMap');
  if (!el) return;
  const rows: { role: string; value: string; meta: string }[] = [
    {
      role: 'Deployer',
      value: f.deployer ? shortAddress(f.deployer, 4) : '— not observed',
      meta: f.deployTxHash
        ? `tx ${shortAddress(f.deployTxHash, 4)}`
        : f.deployer
          ? 'creation-info'
          : 'OKLink proxy or public API',
    },
    {
      role: 'Owner',
      value: f.owner ? shortAddress(f.owner, 4) : '— not readable',
      meta: f.isSafe
        ? `Safe ${f.safeThreshold}/${f.safeOwners?.length ?? '?'}`
        : f.isOwnerContract
          ? 'Contract'
          : f.owner
            ? 'EOA'
            : 'No evidence',
    },
    {
      role: 'Upgrade authority',
      value: f.upgradeAuthority
        ? shortAddress(f.upgradeAuthority, 4)
        : f.isProxy
          ? '— unresolved'
          : '— not a proxy',
      meta: f.proxyAdmin
        ? `Proxy admin ${shortAddress(f.proxyAdmin, 4)}`
        : f.implementation
          ? `Impl ${shortAddress(f.implementation, 4)}`
          : '',
    },
    {
      role: 'Timelock',
      value: f.timelockAddress
        ? shortAddress(f.timelockAddress, 4)
        : '— not observed',
      meta:
        f.timelockMinDelaySec !== null
          ? `${f.timelockMinDelaySec}s min delay`
          : '',
    },
    {
      role: 'Treasury',
      value: f.treasury ? shortAddress(f.treasury, 4) : '— not readable',
      meta: '',
    },
    {
      role: 'Fee recipient',
      value: f.feeRecipient ? shortAddress(f.feeRecipient, 4) : '— not readable',
      meta: '',
    },
  ];

  if (f.roles && f.roles.length > 0) {
    f.roles.forEach((ro) => {
      rows.push({
        role: ro.role + ' (limited)',
        value: ro.holders.map((h) => shortAddress(h, 4)).join(', '),
        meta: 'AccessControl — common roles vs known addrs only',
      });
    });
  }

  el.innerHTML = rows
    .map(
      (r) => `
    <div class="priv-row">
      <div><label>${r.role}</label></div>
      <div class="priv-meta">
        <code>${escapeHtml(r.value)}</code>
        ${r.meta ? `<small>${escapeHtml(r.meta)}</small>` : ''}
      </div>
    </div>`,
    )
    .join('');
}

function renderChecksEmpty() {
  const list = $('#checkList');
  if (list)
    list.innerHTML = `<p class="muted-center">Verify against an approved manifest to load real check results.</p>`;
  setCounts(0, 0, 0, 0, 0, 0);
  const date = $('#checkDate');
  if (date) date.textContent = 'No verification yet';
}

function renderChecks(scan: ScanRun) {
  const list = $('#checkList');
  if (!list) return;
  const c = scan.coverage;
  setCounts(
    c.total,
    c.blocked,
    c.review,
    c.matched,
    c.outOfScope ?? 0,
    c.evidenceMissing ?? 0,
  );
  const date = $('#checkDate');
  if (date)
    date.textContent = `vs approved v${scan.manifestVersion} · ${formatTime(scan.finishedAt)} · block #${scan.facts.blockNumber.toLocaleString()}`;

  const visible =
    checkFilter === 'all'
      ? scan.results
      : checkFilter === 'out_of_scope'
        ? scan.results.filter(
            (r) => r.status === 'skipped' && r.skipReason === 'out_of_scope',
          )
        : checkFilter === 'evidence_missing'
          ? scan.results.filter(
              (r) => r.status === 'skipped' && r.skipReason === 'evidence_missing',
            )
          : scan.results.filter((r) => r.status === checkFilter);

  if (visible.length === 0) {
    list.innerHTML = `<p class="muted-center">No checks in this filter.</p>`;
    return;
  }

  list.innerHTML = visible
    .map(
      (r) => `
    <article class="check-row ${r.status}${r.skipReason ? ` ${r.skipReason}` : ''}" data-check-id="${r.id}">
      <div class="check-state">${
        r.status === 'matched'
          ? '✓'
          : r.skipReason === 'out_of_scope'
            ? '–'
            : r.skipReason === 'evidence_missing'
              ? '?'
              : '!'
      }</div>
      <div class="check-info">
        <div>
          <strong>${escapeHtml(r.title)}</strong>
          <span class="tag ${checkStatusTagClass(r)}">${checkStatusLabel(r)}</span>
        </div>
        <p>
          <span>Expected</span><code>${escapeHtml(shorten(r.expected))}</code>
          <i>→</i>
          <span>Actual</span><code>${escapeHtml(shorten(r.actual))}</code>
        </p>
      </div>
      <button class="evidence-link" type="button" data-check-id="${r.id}">Evidence <span>→</span></button>
    </article>`,
    )
    .join('');
}

function setCounts(
  all: number,
  blocked: number,
  review: number,
  matched: number,
  outOfScope: number,
  evidenceMissing: number,
) {
  const set = (id: string, n: number) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
  };
  set('countAll', all);
  set('countBlocked', blocked);
  set('countReview', review);
  set('countMatched', matched);
  set('countOutOfScope', outOfScope);
  set('countEvidenceMissing', evidenceMissing);
}

function renderReportEmpty() {
  const table = $('#reportTable');
  if (!table) return;
  table.innerHTML = `
    <div class="report-row report-header">
      <span>REPORT</span><span>VERDICT</span><span>CREATED</span><span></span>
    </div>
    <div class="report-row">
      <div>
        <strong>No reports yet</strong>
        <small>Complete a live scan to generate an Auditor Brief.</small>
      </div>
    </div>`;
  const exportBtn = document.getElementById('exportReportBtn') as HTMLButtonElement | null;
  if (exportBtn) exportBtn.disabled = true;
  updateWalletUI();
}

function renderReport(scan: ScanRun) {
  const table = $('#reportTable');
  if (!table) return;
  const tagClass =
    scan.verdict === 'blocked'
      ? 'tag-block'
      : scan.verdict === 'review_required'
        ? 'tag-review'
        : 'tag-pass';
  table.innerHTML = `
    <div class="report-row report-header">
      <span>REPORT</span><span>VERDICT</span><span>CREATED</span><span></span>
    </div>
    <div class="report-row">
      <div>
        <strong>${escapeHtml(scan.manifest.projectName || 'Verification')} · Manifest v${scan.manifestVersion}</strong>
        <small>${networkLabel(scan.network)} · Block #${scan.facts.blockNumber.toLocaleString()} · ${shortAddress(scan.contractAddress, 4)}</small>
      </div>
      <span class="tag ${tagClass}">${verdictLabel(scan.verdict).toUpperCase()}</span>
      <span>${formatTime(scan.finishedAt)}</span>
      <button class="text-btn" id="openBrief3" type="button">View brief →</button>
    </div>`;
  $('#openBrief3')?.addEventListener('click', () => openBrief());
  const exportBtn = document.getElementById('exportReportBtn') as HTMLButtonElement | null;
  if (exportBtn) exportBtn.disabled = false;
  updateWalletUI();
}

function openEvidence(result: CheckResult) {
  const content = $('#evidenceContent');
  if (!content) return;
  const status = checkStatusLabel(result);
  const eye =
    result.status === 'matched'
      ? 'green'
      : result.status === 'blocked'
        ? 'red'
        : result.status === 'review' || result.skipReason === 'evidence_missing'
          ? 'amber'
          : '';

  const limitation = result.checkKey && result.checkKey.includes('role') 
    ? `<div class="evidence-note">Limitation: AccessControl check only tested common roles against known privileged addresses. It did not enumerate every holder via events or getRoleMember.</div>` 
    : '';

  const skipNote =
    result.skipReason === 'out_of_scope'
      ? 'This check is out of scope for the approved policy (undeclared, optional, or N/A). It is not a pass and not a failure.'
      : result.skipReason === 'evidence_missing'
        ? 'The policy expects a value here, but onchain evidence could not be read. Not treated as a match.'
        : 'Direct comparison between the approved manifest and observed deployment state. Shomer does not invent missing values.';

  content.innerHTML = `
    <p class="eyebrow ${eye}">${status}</p>
    <h2>${escapeHtml(result.title)}</h2>
    <p class="modal-sub">${skipNote}</p>
    <div class="evidence-grid">
      <div><label>POLICY EXPECTED</label><code>${escapeHtml(result.expected)}</code></div>
      <div><label>ONCHAIN ACTUAL</label><code>${escapeHtml(result.actual)}</code></div>
    </div>
    <div class="source-box">
      <label>SOURCE EVIDENCE</label>
      <code>${escapeHtml(result.evidence.source)}${
        result.evidence.block ? ` · block ${result.evidence.block}` : ''
      }${result.evidence.txHash ? ` · tx ${result.evidence.txHash}` : ''}${
        result.evidence.slot ? ` · slot ${result.evidence.slot}` : ''
      }</code>
      ${result.evidence.raw ? `<div style="margin-top:6px;opacity:0.85;font-size:11px">Raw: ${escapeHtml(result.evidence.raw)}</div>` : ''}
    </div>
    ${limitation}
    ${
      result.why
        ? `<div class="explain"><strong>Why it matters</strong><p>${escapeHtml(result.why)}</p>
           ${result.remediation ? `<strong>Exact remediation</strong><p>${escapeHtml(result.remediation)}</p>` : ''}
           </div>`
        : ''
    }
    <div class="modal-actions">
      <button class="button ghost" data-close type="button">Close</button>
      <button class="button primary" type="button" id="copyActual">Copy actual value</button>
    </div>`;

  openModal('evidenceModal');
  content.querySelector('[data-close]')?.addEventListener('click', closeModals);
  content.querySelector('#copyActual')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(result.actual);
    toast('Copied to clipboard');
  });
}

function openBrief() {
  if (!lastScan) {
    toast('Verify against an approved manifest first');
    return;
  }
  const scan = lastScan;
  const paper = $('#briefPaper');
  if (!paper) return;
  const pct = coveragePercent(scan.coverage);
  const blockers = scan.results.filter((r) => r.status === 'blocked');
  const reviews = scan.results.filter((r) => r.status === 'review');
  const outOfScope = scan.results.filter(
    (r) => r.status === 'skipped' && r.skipReason === 'out_of_scope',
  );
  const evidenceMissing = scan.results.filter(
    (r) => r.status === 'skipped' && r.skipReason === 'evidence_missing',
  );
  const matched = scan.results.filter((r) => r.status === 'matched');

  const item = (r: CheckResult, cls = '') => `
    <div class="brief-item">
      <b class="${cls}">${checkStatusLabel(r)}</b>
      <span>${escapeHtml(r.title)}</span>
      <code>${escapeHtml(shorten(r.expected))} → ${escapeHtml(shorten(r.actual))}</code>
    </div>`;

  let summary: string;
  if (scan.verdict === 'blocked') {
    summary = `Shomer found ${blockers.length} hard policy violation(s) and ${reviews.length} review item(s) against approved manifest v${scan.manifestVersion}. The deployment is not policy-aligned. This brief does not assert that the protocol is safe or audited.`;
  } else if (scan.verdict === 'review_required') {
    summary = `Against approved manifest v${scan.manifestVersion}, Shomer found no hard blockers among evaluated checks, but ${reviews.length} review item(s) and ${evidenceMissing.length} evidence-missing item(s) need attention. ${outOfScope.length} check(s) are out of scope (undeclared/optional). Do not treat this as a clean launch until review and evidence gaps are resolved.`;
  } else {
    summary = `Every defined hard policy on approved manifest v${scan.manifestVersion} that Shomer could evaluate matched observed onchain state at block ${scan.facts.blockNumber}. ${outOfScope.length} check(s) were out of scope (not failures). This is not a claim that the contract is safe or audited.`;
  }

  const roleNotes = scan.facts.roles.length > 0 
    ? `<div class="brief-section"><p class="eyebrow">ACCESS CONTROL NOTE</p><p>Limited probe only: common roles (DEFAULT_ADMIN, PAUSER, etc.) were checked against known privileged addresses. This is <strong>not</strong> a complete enumeration of every role holder on the contract.</p></div>` 
    : '';

  const deployerLine = scan.facts.deployer 
    ? `Deployer observed: ${scan.facts.deployer}${scan.facts.deployTxHash ? ` (tx ${scan.facts.deployTxHash.slice(0,10)}…)` : ''}`
    : 'Deployer: not observed via public endpoint';

  paper.innerHTML = `
    <div class="brief-brand">
      <span class="brand-mark tiny"><span></span></span> SHOMER
      <small>DEPLOYMENT VERIFICATION</small>
    </div>
    <p class="eyebrow ${verdictEyebrowClass(scan.verdict)}">AUDITOR BRIEF · ${formatTime(scan.finishedAt)}</p>
    <h2>${escapeHtml(scan.manifest.projectName || 'Project')}<br /><i>Manifest v${scan.manifestVersion}</i></h2>

    <div class="brief-verdict">
      <span class="status-orb ${verdictOrbClass(scan.verdict)}"></span>
      <div><small>LAUNCH VERDICT</small><strong>${verdictLabel(scan.verdict)}</strong></div>
      <b>${pct}%<small>POLICY COVERAGE</small></b>
    </div>

    <div class="brief-section">
      <p class="eyebrow">POINT-IN-TIME SCOPE</p>
      <p>
        Approved manifest <strong>v${scan.manifestVersion}</strong> (immutable snapshot)<br />
        ${networkLabel(scan.network)} · Contract ${scan.contractAddress}<br />
        Block #${scan.facts.blockNumber} (chain ${scan.facts.chainId})<br />
        ${deployerLine}<br />
        Code: ${scan.facts.hasCode ? 'present' : 'absent'}${scan.facts.codeHash ? ` · ${scan.facts.codeHash}` : ''}
      </p>
    </div>

    <div class="brief-section">
      <p class="eyebrow">DECISION SUMMARY</p>
      <p style="font-size:13px;line-height:1.6">${escapeHtml(summary)}</p>
    </div>

    ${
      blockers.length
        ? `<div class="brief-section"><p class="eyebrow">BLOCKERS — DO NOT PROCEED</p>${blockers.map((r) => item(r)).join('')}</div>`
        : ''
    }
    ${
      reviews.length
        ? `<div class="brief-section"><p class="eyebrow">REVIEW REQUIRED</p>${reviews.map((r) => item(r, 'review-b')).join('')}</div>`
        : ''
    }
    ${roleNotes}
    ${
      evidenceMissing.length
        ? `<div class="brief-section"><p class="eyebrow">EVIDENCE MISSING (DECLARED OR REQUIRED — NOT A PASS)</p>${evidenceMissing.map((r) => item(r, 'review-b')).join('')}</div>`
        : ''
    }
    ${
      outOfScope.length
        ? `<div class="brief-section"><p class="eyebrow">OUT OF SCOPE (UNDECLARED / OPTIONAL / N/A — NOT A FAILURE)</p>${outOfScope.map((r) => item(r, 'skip-b')).join('')}</div>`
        : ''
    }
    ${
      matched.length
        ? `<div class="brief-section"><p class="eyebrow">POLICY MATCHED (${matched.length} checks)</p><div style="font-size:12px;opacity:0.85">Against approved v${scan.manifestVersion}. Matched items were both declared (or hard-required) and successfully verified onchain.</div></div>`
        : ''
    }

    <div class="brief-section">
      <p class="eyebrow">PRIVILEGE SUMMARY (OBSERVED)</p>
      <p style="font-family:var(--mono);font-size:12px;line-height:1.5">
        Owner: ${scan.facts.owner || '—'} ${scan.facts.isSafe ? `(Safe ${scan.facts.safeThreshold}/?)` : ''}<br />
        Upgrade: ${scan.facts.upgradeAuthority || (scan.facts.isProxy ? 'proxy (admin not resolved)' : 'not a proxy')}<br />
        ${scan.facts.roles.length ? `Roles (limited probe): ${scan.facts.roles.map(r => r.role).join(', ')}` : 'No AccessControl roles detected on known addresses.'}
      </p>
    </div>

    ${
      scan.facts.readErrors.length
        ? `<div class="brief-section"><p class="eyebrow">READ LIMITATIONS</p><p style="font-size:12px">${scan.facts.readErrors.map(e => escapeHtml(e)).join('<br/>')}</p></div>`
        : ''
    }

    <p class="brief-foot">
      <strong>Shomer verifies declared policy against observable onchain state at a specific block.</strong><br />
      This is <em>not</em> a security audit and does not claim the contract is safe, correct, or free of vulnerabilities.<br />
      AccessControl checks are limited to common roles against known addresses only. Full enumeration requires events or getRoleMember support.
    </p>`;

  openModal('briefModal');
}

// —— Founder loop: live read (no verdict) vs verify approved ——
async function readLiveState() {
  syncDraftFromForm();
  const network =
    (($('#fieldNetwork') as HTMLSelectElement)?.value ||
    policy.draft.network ||
    'botchain-mainnet') as any;
  const addrRaw =
    ($('#fieldContract') as HTMLInputElement)?.value.trim() ||
    policy.draft.contractAddress;
  const addr = normalizeAddress(addrRaw);
  if (!addr) {
    toast('Enter a valid contract address');
    showPanel('overview');
    ($('#fieldContract') as HTMLInputElement | null)?.focus();
    return;
  }

  policy.draft.network = network;
  policy.draft.contractAddress = addr;
  manifest = policy.draft;
  savePolicyState(policy);

  const overlay = $('#scanOverlay');
  const step = $('#scanStep');
  const detail = $('#scanDetail');
  overlay?.removeAttribute('hidden');
  setButtonsBusy(true);

  try {
    if (step) step.textContent = 'Connecting to BOT Chain RPC…';
    if (detail) detail.textContent = networkLabel(network);
    await tick(150);
    if (step) step.textContent = 'Reading live ownership, proxy, timelock…';
    if (detail) detail.textContent = addr;
    const facts = await readFacts({ network, contractAddress: addr });
    lastFacts = facts;
    saveLastFacts(facts);
    applyTokenProjectNameFromFacts(facts);
    // Do NOT run policy checks or invent a verdict from live import
    lastScan = null;
    clearLastScanSafe();
    if (step) step.textContent = 'Live state ready';
    if (detail) detail.textContent = `Block #${facts.blockNumber} — draft only until you approve`;
    await tick(200);
    fillManifestForm();
    renderAll();
    toast(
      facts.deployer
        ? `On-chain read done · deployer ${shortAddress(facts.deployer, 4)}. Next: Your rules → Lock in (not a match yet).`
        : 'On-chain read done. Next: Your rules → Lock in. We never mark a match just from reading.',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast(`Live read failed: ${msg}`);
    console.error(err);
  } finally {
    overlay?.setAttribute('hidden', '');
    setButtonsBusy(false);
  }
}

async function verifyAgainstApproved() {
  syncDraftFromForm();
  if (!policy.approved) {
    toast('Approve a manifest version first — verification requires an immutable policy');
    showPanel('manifest');
    return;
  }

  const approved = policy.approved;
  const addr = normalizeAddress(approved.fields.contractAddress);
  if (!addr) {
    toast('Approved manifest has no contract address');
    return;
  }

  const overlay = $('#scanOverlay');
  const step = $('#scanStep');
  const detail = $('#scanDetail');
  overlay?.removeAttribute('hidden');
  setButtonsBusy(true);
  const startedAt = new Date().toISOString();

  try {
    if (step) step.textContent = 'Connecting to BOT Chain RPC…';
    if (detail) detail.textContent = `Manifest v${approved.version}`;
    await tick(120);
    if (step) step.textContent = 'Reading live state…';
    if (detail) detail.textContent = addr;
    const facts = await readFacts({
      network: approved.fields.network,
      contractAddress: addr,
    });
    lastFacts = facts;
    saveLastFacts(facts);

    if (step) step.textContent = `Comparing to approved v${approved.version}…`;
    if (detail) detail.textContent = 'Immutable snapshot only — draft is not used';
    await tick(120);

    const scan = buildScanRun(
      approved.fields,
      facts,
      startedAt,
      approved.version,
    );
    lastScan = scan;
    saveLastScan(scan);

    if (step) step.textContent = verdictLabel(scan.verdict);
    if (detail)
      detail.textContent = `v${approved.version} · ${scan.coverage.blocked} blocked · ${scan.coverage.matched} matched`;
    await tick(250);

    renderAll();
    showPanel('scans');
    toast(
      `Verified vs approved v${approved.version} — ${scan.coverage.blocked} blocked, ${scan.coverage.review} review, ${scan.coverage.matched} matched, ${scan.coverage.skipped} skipped`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast(`Verify failed: ${msg}`);
    console.error(err);
  } finally {
    overlay?.setAttribute('hidden', '');
    setButtonsBusy(false);
  }
}

function setButtonsBusy(busy: boolean) {
  [
    'runCheck',
    'runCheck2',
    'runCheckForm',
    'verifyApproved',
    'fillFromLive',
    'fillFromLive2',
    'approveManifest',
  ].forEach((id) => {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = busy;
    if (busy) {
      btn.dataset.original = btn.innerHTML;
      btn.innerHTML = `Working <span class="spinner"></span>`;
    } else if (btn.dataset.original) {
      btn.innerHTML = btn.dataset.original;
    }
  });
}

function tick(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shorten(s: string, max = 72): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}


function loadSampleContract(opts?: { autoRead?: boolean; enterFromLanding?: boolean }) {
  return loadBotChainSampleContract(opts);
}

function loadBotChainSampleContract(opts?: { autoRead?: boolean; enterFromLanding?: boolean }) {
  const autoRead = opts?.autoRead ?? true;
  const netSel = document.getElementById('fieldNetwork') as HTMLSelectElement | null;
  const caInput = document.getElementById('fieldContract') as HTMLInputElement | null;
  const nameInput = document.getElementById('fieldProjectName') as HTMLInputElement | null;
  if (netSel) netSel.value = 'botchain-mainnet';
  if (caInput) caInput.value = SAMPLE_BOTCHAIN_CONTRACT;
  if (nameInput) nameInput.value = SAMPLE_BOTCHAIN_PROJECT_NAME;
  policy.draft.network = 'botchain-mainnet';
  policy.draft.contractAddress = SAMPLE_BOTCHAIN_CONTRACT;
  policy.draft.projectName = SAMPLE_BOTCHAIN_PROJECT_NAME;
  savePolicyState(policy);
  toast('Sample CipherBallot on BOT Chain loaded');
  if (autoRead) {
    window.setTimeout(() => void readLiveState(), opts?.enterFromLanding ? 520 : 80);
  }
}

function verdictToCode(verdict: string): number {
  if (verdict === 'matched' || verdict === 'policy_matched') return 0;
  if (verdict === 'review_required' || verdict === 'review') return 1;
  return 2;
}

function exportReportJson() {
  if (!lastScan) {
    toast('No verification available to export.');
    return;
  }
  const report = buildPublicReportSnapshot(lastScan);
  const jsonStr = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.reportId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Exported report ${report.reportId}.json`);
}

let userWalletAddress: Address | null = null;
let userWalletChainId: number | null = null;

function updateWalletUI() {
  const connectBtn = document.getElementById('connectWalletBtn');
  const statusText = document.getElementById('walletStatusText');
  const publishBtn = document.getElementById('publishReceiptBtn') as HTMLButtonElement | null;

  if (!userWalletAddress) {
    if (connectBtn) connectBtn.textContent = 'Connect wallet';
    if (statusText) statusText.textContent = 'No wallet connected';
    if (publishBtn) publishBtn.disabled = true;
  } else {
    if (connectBtn) connectBtn.textContent = shortAddress(userWalletAddress, 4);
    let chainName = 'Unknown network';
    try {
      if (userWalletChainId) chainName = resolveChain(userWalletChainId).name;
    } catch {
      chainName = `Unsupported chain (${userWalletChainId})`;
    }
    if (statusText) {
      statusText.textContent = `Connected: ${shortAddress(userWalletAddress, 4)} on ${chainName}`;
    }
    if (publishBtn) publishBtn.disabled = !lastScan;
  }
}

async function connectWallet(): Promise<Address | null> {
  const ethereum = (window as unknown as { ethereum?: any }).ethereum;
  if (!ethereum) {
    toast('No Web3 wallet found. Please install MetaMask, OKX Wallet, or Bohr Wallet.');
    return null;
  }
  try {
    const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts || accounts.length === 0) {
      toast('No account selected.');
      return null;
    }
    userWalletAddress = getAddress(accounts[0]);
    const chainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
    userWalletChainId = parseInt(chainHex, 16);

    // Subscribe to events once
    if (ethereum.on && !(window as any).__shomerWalletListening) {
      (window as any).__shomerWalletListening = true;
      ethereum.on('accountsChanged', (newAccounts: string[]) => {
        if (!newAccounts || newAccounts.length === 0) {
          userWalletAddress = null;
        } else {
          userWalletAddress = getAddress(newAccounts[0]);
        }
        updateWalletUI();
      });
      ethereum.on('chainChanged', (newChainHex: string) => {
        userWalletChainId = parseInt(newChainHex, 16);
        updateWalletUI();
      });
    }

    updateWalletUI();
    toast(`Wallet connected: ${shortAddress(userWalletAddress, 4)}`);
    return userWalletAddress;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    toast(`Wallet connection failed: ${msg}`);
    return null;
  }
}

async function publishVerificationReceipt() {
  if (!lastScan) {
    toast('Run verification first to generate a report snapshot.');
    return;
  }
  const ethereum = (window as unknown as { ethereum?: any }).ethereum;
  if (!ethereum) {
    toast('No Web3 wallet found. Please install MetaMask, OKX Wallet, or Bohr Wallet.');
    return;
  }

  if (!userWalletAddress) {
    const connected = await connectWallet();
    if (!connected) return;
  }

  const targetChain = resolveChain(lastScan.manifest.network || 'mainnet');
  const publishBtn = document.getElementById('publishReceiptBtn') as HTMLButtonElement | null;
  const statusBox = document.getElementById('publishStatusBox');
  const statusMsg = document.getElementById('publishStatusMsg');
  const detailsBox = document.getElementById('publishReceiptDetails');

  // Verify wallet network matches targetChain.id
  try {
    const currentChainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
    const currentChainId = parseInt(currentChainHex, 16);

    if (currentChainId !== targetChain.id) {
      if (statusBox) statusBox.hidden = false;
      if (statusMsg) statusMsg.textContent = `Switching network to ${targetChain.name} (${targetChain.id})…`;

      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${targetChain.id.toString(16)}` }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: `0x${targetChain.id.toString(16)}`,
                chainName: targetChain.name,
                nativeCurrency: targetChain.nativeCurrency,
                rpcUrls: [targetChain.rpcUrls.default.http[0]],
                blockExplorerUrls: targetChain.blockExplorers?.default?.url
                  ? [targetChain.blockExplorers.default.url]
                  : undefined,
              },
            ],
          });
        } else {
          throw switchError;
        }
      }
      userWalletChainId = targetChain.id;
      updateWalletUI();
    }
  } catch (switchErr: any) {
    if (statusBox) statusBox.hidden = false;
    if (statusMsg) {
      statusMsg.textContent = `Network switch rejected. Publication blocked: wallet must be on ${targetChain.name} (${targetChain.id}).`;
    }
    toast(`Please switch wallet network to ${targetChain.name} (${targetChain.id})`);
    return;
  }

  const registryAddress = SHOMER_REGISTRY_ADDRESSES[targetChain.id];
  if (!registryAddress) {
    toast(`No Shomer registry configured on ${targetChain.name} (${targetChain.id}).`);
    return;
  }

  if (publishBtn) publishBtn.disabled = true;
  if (statusBox) statusBox.hidden = false;
  if (statusMsg) statusMsg.textContent = `Preparing receipt for ${targetChain.name}…`;

  try {
    const snapshot = buildPublicReportSnapshot(lastScan);
    const reportHash = computeReportHash(snapshot);
    const pHash = snapshot.policyHash;
    const verdictCode = verdictToCode(lastScan.verdict);
    const targetAddr = getAddress(lastScan.contractAddress);
    const inspectedBlock = BigInt(lastScan.facts.blockNumber);

    const data = encodeFunctionData({
      abi: shomerRegistryAbi,
      functionName: 'publishVerification',
      args: [
        BigInt(targetChain.id),
        targetAddr,
        inspectedBlock,
        pHash,
        reportHash,
        verdictCode,
      ],
    });

    if (statusMsg) statusMsg.textContent = 'Awaiting signature in wallet…';

    const txHash = (await ethereum.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: userWalletAddress,
          to: registryAddress,
          data,
        },
      ],
    })) as Hex;

    const recordId = computeRecordId(
      userWalletAddress!,
      BigInt(targetChain.id),
      targetAddr,
      inspectedBlock,
      pHash,
      reportHash,
    );

    const txUrl = getExplorerTxUrl(targetChain.id, txHash);

    if (statusMsg) {
      statusMsg.innerHTML = `✓ Verification receipt published to ${escapeHtml(targetChain.name)}!`;
    }
    if (detailsBox) {
      detailsBox.innerHTML = `
        <div style="margin-top:6px;line-height:1.6;">
          <div><strong>Tx:</strong> <a href="${txUrl}" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;">${txHash}</a></div>
          <div><strong>Record ID:</strong> <code>${recordId}</code></div>
          <div><strong>Report Hash:</strong> <code>${reportHash}</code></div>
          <div><strong>Policy Hash:</strong> <code>${pHash}</code></div>
          <div><strong>Publisher:</strong> <code>${userWalletAddress}</code></div>
          <div><strong>Inspected Block:</strong> #${inspectedBlock.toString()}</div>
          <div><strong>Registry:</strong> <code>${registryAddress}</code></div>
        </div>
      `;
    }

    toast('Verification receipt published on-chain!');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (statusMsg) statusMsg.textContent = `Publication failed: ${msg}`;
    toast(`Publication failed: ${msg}`);
  } finally {
    if (publishBtn) publishBtn.disabled = false;
  }
}

async function handleVerifyIntegrity() {
  const fileInput = document.getElementById('reportFileInput') as HTMLInputElement | null;
  const textInput = document.getElementById('reportLookupInput') as HTMLInputElement | null;
  const resultBox = document.getElementById('integrityResultBox');

  if (!resultBox) return;
  resultBox.hidden = false;
  resultBox.innerHTML = 'Verifying report integrity…';
  resultBox.style.background = '#f4f6f0';
  resultBox.style.border = '1px solid var(--line)';
  resultBox.style.color = 'inherit';

  let rawContent = '';
  if (fileInput?.files && fileInput.files.length > 0) {
    try {
      rawContent = await fileInput.files[0].text();
    } catch (e) {
      resultBox.style.background = '#fef2f2';
      resultBox.style.borderColor = '#fca5a5';
      resultBox.innerHTML = `<strong>Error reading file:</strong> ${(e as Error).message}`;
      return;
    }
  } else if (textInput?.value.trim()) {
    rawContent = textInput.value.trim();
  }

  if (!rawContent) {
    resultBox.style.background = '#fef2f2';
    resultBox.style.borderColor = '#fca5a5';
    resultBox.innerHTML = '<strong>Please upload a report JSON file or paste report JSON / Record ID.</strong>';
    return;
  }

  // Check if rawContent is a 32-byte Record ID (0x followed by 64 hex characters)
  if (/^0x[0-9a-fA-F]{64}$/.test(rawContent)) {
    const recordId = rawContent as Hex;
    resultBox.innerHTML = `Querying on-chain registry for Record ID: <code>${recordId}</code>…`;

    const candidateChains = [resolveChain(677), resolveChain(196), resolveChain(968), resolveChain(1952)];
    let foundRecord: OnchainVerificationRecord | null = null;
    let foundChainId: number | null = null;

    for (const chain of candidateChains) {
      const regAddr = SHOMER_REGISTRY_ADDRESSES[chain.id];
      if (!regAddr) continue;
      try {
        const client = createPublicClient({
          chain,
          transport: fallback([http()]),
        });
        const rec = (await client.readContract({
          address: regAddr,
          abi: shomerRegistryAbi,
          functionName: 'getRecord',
          args: [recordId],
        })) as any;

        if (rec && rec.publisher && rec.publisher !== '0x0000000000000000000000000000000000000000') {
          foundRecord = {
            publisher: rec.publisher,
            inspectedChain: Number(rec.inspectedChain),
            targetContract: rec.targetContract,
            inspectedBlock: Number(rec.inspectedBlock),
            policyHash: rec.policyHash,
            reportHash: rec.reportHash,
            verdict: Number(rec.verdict),
            publishedAt: Number(rec.publishedAt),
          };
          foundChainId = chain.id;
          break;
        }
      } catch {
        // Continue search
      }
    }

    if (foundRecord && foundChainId) {
      const vLabel =
        foundRecord.verdict === 0
          ? 'MATCHED'
          : foundRecord.verdict === 1
            ? 'REVIEW REQUIRED'
            : 'BLOCKED';
      resultBox.style.background = '#f0fdf4';
      resultBox.style.borderColor = '#86efac';
      resultBox.innerHTML = `
        <div style="font-weight:600;color:#166534;margin-bottom:6px;">✓ On-Chain Record Found on ${resolveChain(foundChainId).name} (${foundChainId})</div>
        <div style="font-family:var(--mono);line-height:1.6;">
          <div><strong>Publisher:</strong> <code>${foundRecord.publisher}</code></div>
          <div><strong>Target:</strong> <code>${foundRecord.targetContract}</code></div>
          <div><strong>Inspected Chain:</strong> ${foundRecord.inspectedChain}</div>
          <div><strong>Inspected Block:</strong> #${foundRecord.inspectedBlock.toLocaleString()}</div>
          <div><strong>Verdict:</strong> ${vLabel}</div>
          <div><strong>Policy Hash:</strong> <code>${foundRecord.policyHash}</code></div>
          <div><strong>Report Hash:</strong> <code>${foundRecord.reportHash}</code></div>
          <div><strong>Published:</strong> ${new Date(foundRecord.publishedAt * 1000).toISOString()}</div>
        </div>
      `;
      return;
    } else {
      resultBox.style.background = '#fef2f2';
      resultBox.style.borderColor = '#fca5a5';
      resultBox.innerHTML = `<strong>Record not found:</strong> No registry record exists for <code>${recordId}</code> on checked chains.`;
      return;
    }
  }

  // Parse as JSON report
  let report: ShomerPublicReport;
  try {
    report = JSON.parse(rawContent);
  } catch (err) {
    resultBox.style.background = '#fef2f2';
    resultBox.style.borderColor = '#fca5a5';
    resultBox.innerHTML = `<strong>Invalid JSON:</strong> ${(err as Error).message}`;
    return;
  }

  if (report.format !== 'shomer-public-report/v1') {
    resultBox.style.background = '#fef2f2';
    resultBox.style.borderColor = '#fca5a5';
    resultBox.innerHTML = `<strong>Unsupported report format:</strong> expected "shomer-public-report/v1", got "${escapeHtml(String(report.format))}".`;
    return;
  }

  const computedHash = computeReportHash(report);
  const internalHashMatch =
    Boolean(report.reportHash) &&
    computedHash.toLowerCase() === report.reportHash!.toLowerCase();

  if (!internalHashMatch) {
    resultBox.style.background = '#fef2f2';
    resultBox.style.borderColor = '#fca5a5';
    resultBox.innerHTML = `
      <div style="font-weight:600;color:#991b1b;margin-bottom:6px;">⚠ REPORT TAMPERED OR CORRUPTED</div>
      <div style="line-height:1.5;">
        <div>The canonical hash of the report content does not match its internal header.</div>
        <div><strong>Computed Hash:</strong> <code>${computedHash}</code></div>
        <div><strong>Header Hash:</strong> <code>${report.reportHash ?? 'missing'}</code></div>
      </div>
    `;
    return;
  }

  const chain = resolveChain(report.inspectedChain);
  const regAddr = SHOMER_REGISTRY_ADDRESSES[chain.id];

  let onchainRec: OnchainVerificationRecord | null = null;
  if (regAddr && report.receipt?.recordId) {
    try {
      const client = createPublicClient({ chain, transport: fallback([http()]) });
      const rec = (await client.readContract({
        address: regAddr,
        abi: shomerRegistryAbi,
        functionName: 'getRecord',
        args: [report.receipt.recordId as Hex],
      })) as any;

      if (rec && rec.publisher && rec.publisher !== '0x0000000000000000000000000000000000000000') {
        onchainRec = {
          publisher: rec.publisher,
          inspectedChain: Number(rec.inspectedChain),
          targetContract: rec.targetContract,
          inspectedBlock: Number(rec.inspectedBlock),
          policyHash: rec.policyHash,
          reportHash: rec.reportHash,
          verdict: Number(rec.verdict),
          publishedAt: Number(rec.publishedAt),
        };
      }
    } catch {
      // Non-fatal if offline
    }
  }

  if (onchainRec) {
    const comparison = verifyReportIntegrity(report, onchainRec);
    if (comparison.valid) {
      resultBox.style.background = '#f0fdf4';
      resultBox.style.borderColor = '#86efac';
      resultBox.innerHTML = `
        <div style="font-weight:600;color:#166534;margin-bottom:6px;">✓ AUTHENTIC ON-CHAIN RECEIPT VERIFIED</div>
        <div style="line-height:1.6;font-family:var(--mono);">
          <div><strong>Status:</strong> Deterministic report hash matches on-chain record exactly.</div>
          <div><strong>Inspected Chain:</strong> ${chain.name} (${report.inspectedChain})</div>
          <div><strong>Target Contract:</strong> ${report.targetContract}</div>
          <div><strong>Inspected Block:</strong> #${report.inspectedBlock.toLocaleString()}</div>
          <div><strong>Report Hash:</strong> <code>${report.reportHash}</code></div>
          <div><strong>Publisher:</strong> <code>${onchainRec.publisher}</code></div>
          <div><strong>Verdict:</strong> ${report.verdict.toUpperCase()}</div>
        </div>
      `;
    } else {
      resultBox.style.background = '#fef2f2';
      resultBox.style.borderColor = '#fca5a5';
      resultBox.innerHTML = `
        <div style="font-weight:600;color:#991b1b;margin-bottom:6px;">⚠ INTEGRITY MISMATCH WITH ON-CHAIN RECORD</div>
        <ul style="margin:6px 0 0;padding-left:18px;">
          ${comparison.mismatches.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}
        </ul>
      `;
    }
  } else {
    // Valid standalone deterministic snapshot
    resultBox.style.background = '#eff6ff';
    resultBox.style.borderColor = '#bfdbfe';
    resultBox.innerHTML = `
      <div style="font-weight:600;color:#1e40af;margin-bottom:6px;">✓ VALID DETERMINISTIC REPORT SNAPSHOT</div>
      <div style="line-height:1.6;font-family:var(--mono);">
        <div><strong>Status:</strong> Canonical keccak256 hash valid. (No on-chain receipt linked yet).</div>
        <div><strong>Inspected Chain:</strong> ${chain.name} (${report.inspectedChain})</div>
        <div><strong>Target Contract:</strong> ${report.targetContract}</div>
        <div><strong>Inspected Block:</strong> #${report.inspectedBlock.toLocaleString()}</div>
        <div><strong>Report Hash:</strong> <code>${report.reportHash}</code></div>
        <div><strong>Verdict:</strong> ${report.verdict.toUpperCase()}</div>
      </div>
    `;
  }
}

function clearIntegrityVerification() {
  const fileInput = document.getElementById('reportFileInput') as HTMLInputElement | null;
  const textInput = document.getElementById('reportLookupInput') as HTMLInputElement | null;
  const resultBox = document.getElementById('integrityResultBox');
  if (fileInput) fileInput.value = '';
  if (textInput) textInput.value = '';
  if (resultBox) {
    resultBox.hidden = true;
    resultBox.innerHTML = '';
  }
}

// —— Events ——


function applyPolicyPackToDraft(opts?: { fillFromLive?: boolean }) {
  const sel = document.getElementById('policyPackSelect') as HTMLSelectElement | null;
  const packId = sel?.value?.trim() ?? '';
  if (!packId) {
    toast('Choose a policy pack first');
    return;
  }
  syncDraftFromForm();
  const seeded = seedDraftFromPack({
    packId,
    network: policy.draft.network,
    contractAddress: policy.draft.contractAddress,
    projectName: policy.draft.projectName,
  });
  if (!seeded.ok) {
    toast(seeded.message);
    return;
  }
  policy.draft = seeded.draft;
  // Pack apply is founder intent for defaults
  policy.provenance = {};
  for (const k of seeded.pack.fields) {
    policy.provenance[k] = 'founder';
  }
  if (opts?.fillFromLive && lastFacts) {
    policy = applyLiveImportToDraft(policy, lastFacts);
  }
  manifest = policy.draft;
  savePolicyState(policy);
  fillManifestForm();
  renderAll();
  showPanel('manifest');
  toast(
    opts?.fillFromLive
      ? `Template “${seeded.pack.title}” applied and filled from chain — still work-in-progress, not locked.`
      : `Template “${seeded.pack.title}” filled in. Review the list, then Lock in when it looks right.`,
  );
}

function renderPolicyPackDesc() {
  const sel = document.getElementById('policyPackSelect') as HTMLSelectElement | null;
  const desc = document.getElementById('policyPackDesc');
  if (!desc) return;
  const pack = getPolicyPack(sel?.value ?? '');
  desc.textContent = pack
    ? `${pack.description} We’ll only ask about: ${pack.fields.filter((f) => f !== 'network' && f !== 'contractAddress').join(', ')}.`
    : 'Pick a template to pre-fill common rules. You still review and lock them.';
}

function renderPolicyDiff() {
  try { syncDraftFromForm(); } catch { /* form may be mid-render */ }
  const card = document.getElementById('policyDiffCard');
  const list = document.getElementById('policyDiffList');
  const sub = document.getElementById('policyDiffSubtitle');
  if (!card || !list) return;
  if (!policy.approved) {
    card.setAttribute('hidden', '');
    list.innerHTML = '';
    return;
  }
  // Compare approved snapshot to current draft (form-synced by callers)
  const diffs = diffManifestFields(policy.approved.fields, policy.draft);
  if (diffs.length === 0) {
    card.removeAttribute('hidden');
    if (sub) {
      sub.textContent = `Your work matches locked v${policy.approved.version}. Locking again would create v${policy.approved.version + 1} with the same rules.`;
    }
    list.innerHTML = `<p class="muted-center" style="margin:0;text-align:left">No changes vs locked v${policy.approved.version}.</p>`;
    return;
  }
  card.removeAttribute('hidden');
  if (sub) {
    sub.textContent = `${diffs.length} change(s) vs locked v${policy.approved.version}. Review before you lock v${policy.approved.version + 1}.`;
  }
  list.innerHTML = diffs
    .map(
      (d) => `
    <div class="policy-diff-row">
      <span class="kind">${escapeHtml(d.kind.toUpperCase())}</span>
      <b>${escapeHtml(d.key)}</b>
      <span class="from">from: ${escapeHtml(d.from)}</span>
      <span class="to">to: ${escapeHtml(d.to)}</span>
    </div>`,
    )
    .join('');
}

function applyTokenProjectNameFromFacts(facts: ObservedFacts) {
  const label = suggestedProjectName(facts.tokenName, facts.tokenSymbol);
  if (!label) return;
  if (!isPlaceholderProjectName(policy.draft.projectName)) return;
  policy.draft.projectName = label;
  const input = document.getElementById('fieldProjectName') as HTMLInputElement | null;
  if (input) input.value = label;
  const crumb = document.getElementById('projectCrumb');
  if (crumb) crumb.textContent = label;
  savePolicyState(policy);
}

function bindEvents() {
  const enterApp = () => {
    const landing = document.getElementById('landing');
    landing?.classList.add('leaving');
    window.setTimeout(() => {
      landing?.setAttribute('hidden', '');
      document.getElementById('appShell')?.classList.add('app-visible');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showPanel('overview');
      ($('#fieldContract') as HTMLInputElement | null)?.focus();
    }, 420);
  };

  const showLanding = (e?: Event) => {
    e?.preventDefault();
    const landing = document.getElementById('landing');
    const app = document.getElementById('appShell');
    app?.classList.remove('app-visible');
    landing?.removeAttribute('hidden');
    landing?.classList.remove('leaving');
    // Jump to top of marketing page
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Focus brand for a11y after returning
    (document.querySelector('.landing-brand') as HTMLElement | null)?.focus?.();
  };

  $('#landingVerify')?.addEventListener('click', enterApp);
  $('#landingOpenAppClose')?.addEventListener('click', enterApp);
  $('#landingStartCheck')?.addEventListener('click', scrollToVerifyForm);
  document.querySelectorAll('[data-go-landing]').forEach((el) => {
    el.addEventListener('click', showLanding);
  });

  const runSampleFromLanding = () => {
    runBotChainSampleFromLanding();
  };

  const runBotChainSampleFromLanding = () => {
    const landingNet = document.getElementById('landingNetwork') as HTMLSelectElement | null;
    const landingCa = document.getElementById('landingContract') as HTMLInputElement | null;
    if (landingNet) landingNet.value = 'botchain-mainnet';
    if (landingCa) landingCa.value = SAMPLE_BOTCHAIN_CONTRACT;
    const enter = () => {
      const landing = document.getElementById('landing');
      landing?.classList.add('leaving');
      window.setTimeout(() => {
        landing?.setAttribute('hidden', '');
        document.getElementById('appShell')?.classList.add('app-visible');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showPanel('overview');
        loadBotChainSampleContract({ autoRead: true, enterFromLanding: false });
      }, 420);
    };
    enter();
  };

  document.getElementById('landingTrySample')?.addEventListener('click', runSampleFromLanding);
  document.getElementById('landingTryBotChain')?.addEventListener('click', runBotChainSampleFromLanding);
  document.getElementById('trySampleContract')?.addEventListener('click', () =>
    loadSampleContract({ autoRead: true }),
  );
  document.getElementById('tryBotChainSample')?.addEventListener('click', () =>
    loadBotChainSampleContract({ autoRead: true }),
  );
  document.getElementById('trySampleInForm')?.addEventListener('click', () =>
    loadSampleContract({ autoRead: true }),
  );

  const copyAgentCurl = document.getElementById('copyAgentCurl');
  const agentCurlSample = document.getElementById('agentCurlSample');
  copyAgentCurl?.addEventListener('click', async () => {
    const text = agentCurlSample?.textContent?.trim() ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('Curl copied');
      copyAgentCurl.textContent = 'Copied';
      window.setTimeout(() => {
        copyAgentCurl.textContent = 'Copy';
      }, 1600);
    } catch {
      toast('Could not copy — select the curl manually');
    }
  });

  const landingForm = document.getElementById('landingVerifyForm') as HTMLFormElement | null;
  landingForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const net = (document.getElementById('landingNetwork') as HTMLSelectElement | null)?.value;
    const ca = (document.getElementById('landingContract') as HTMLInputElement | null)?.value.trim();
    if (net) {
      const sel = document.getElementById('fieldNetwork') as HTMLSelectElement | null;
      if (sel) sel.value = net;
      policy.draft.network = (net || 'botchain-mainnet') as any;
    }
    if (ca) {
      const input = document.getElementById('fieldContract') as HTMLInputElement | null;
      if (input) input.value = ca;
      policy.draft.contractAddress = ca;
    }
    savePolicyState(policy);
    enterApp();
    if (ca) {
      setTimeout(() => void readLiveState(), 500);
    }
  });

  const previewBriefBtn = document.getElementById('previewBrief');
  if (previewBriefBtn) {
    previewBriefBtn.addEventListener('click', () => {
      enterApp();
      setTimeout(() => {
        showPanel('reports');
        const btn = document.getElementById('openBrief2');
        if (btn) (btn as HTMLButtonElement).click();
      }, 600);
    });
  }

  document.querySelectorAll('[data-panel]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.panel;
      if (id) showPanel(id);
    });
  });

  document.body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const panelTarget = t.closest('[data-panel-target]') as HTMLElement | null;
    if (panelTarget?.dataset.panelTarget) {
      showPanel(panelTarget.dataset.panelTarget);
      return;
    }
    const checkEl = t.closest('[data-check-id]') as HTMLElement | null;
    if (checkEl?.dataset.checkId && lastScan) {
      const result = lastScan.results.find(
        (r) => r.id === checkEl.dataset.checkId,
      );
      if (result) openEvidence(result);
    }
  });

  document.querySelectorAll('[data-close], #modalBackdrop').forEach((e) => {
    e.addEventListener('click', closeModals);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      checkFilter = ((tab as HTMLElement).dataset.filter || 'all') as typeof checkFilter;
      if (lastScan) renderChecks(lastScan);
    });
  });

  $('#viewManifest')?.addEventListener('click', () => showPanel('manifest'));
  $('#saveManifest')?.addEventListener('click', persistManifest);
  $('#approveManifest')?.addEventListener('click', approveManifestAction);
  document.getElementById('applyPolicyPack')?.addEventListener('click', () =>
    applyPolicyPackToDraft({ fillFromLive: false }),
  );
  document.getElementById('applyPackFromLive')?.addEventListener('click', () =>
    applyPolicyPackToDraft({ fillFromLive: true }),
  );
  document.getElementById('policyPackSelect')?.addEventListener('change', () => {
    renderPolicyPackDesc();
  });

  $('#fillFromLive')?.addEventListener('click', fillDraftFromLive);
  $('#fillFromLive2')?.addEventListener('click', fillDraftFromLive);
  $('#runCheck')?.addEventListener('click', () => void readLiveState());
  $('#runCheck2')?.addEventListener('click', () => void verifyAgainstApproved());
  $('#verifyApproved')?.addEventListener('click', () => void verifyAgainstApproved());
  $('#verifyFromManifest')?.addEventListener('click', () => void verifyAgainstApproved());
  $('#openBrief')?.addEventListener('click', openBrief);
  $('#openBrief2')?.addEventListener('click', openBrief);
  $('#printBrief')?.addEventListener('click', () => window.print());
  $('#exportReportBtn')?.addEventListener('click', exportReportJson);
  $('#connectWalletBtn')?.addEventListener('click', () => void connectWallet());
  $('#publishReceiptBtn')?.addEventListener('click', () => void publishVerificationReceipt());
  $('#verifyIntegrityBtn')?.addEventListener('click', () => void handleVerifyIntegrity());
  $('#clearIntegrityBtn')?.addEventListener('click', clearIntegrityVerification);

  $('#verifyForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void readLiveState();
  });

  // Track founder edits on importable fields
  const form = $('#manifestForm') as HTMLFormElement | null;
  form?.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t?.name) return;
    if ((IMPORTABLE_FIELD_KEYS as string[]).includes(t.name)) {
      policy.provenance = markFounderField(
        policy.provenance,
        t.name as ManifestFieldKey,
      );
      savePolicyState(policy);
      decorateManifestLabels();
    }
  });

  $('#fieldNetwork')?.addEventListener('change', updateNetworkLabel);
  document.querySelectorAll('[data-network-switch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toast('Network locked to BOT Chain Mainnet (Chain 677)');
    });
  });

  $('#newScanBtn')?.addEventListener('click', () => {
    resetSession();
  });
}

// —— Boot ——
fillManifestForm();
bindEvents();
renderAll();
initHubFocusCycle();
