'use strict';

/*
 * ESCC privacy-purge (NEW for ESCC) — operator-invoked erasure, mounted by
 * `escc privacy-purge <identifier>` (spec §A.6, "GDPR erasure").
 *
 * Erases a data subject's data from the entity-scoped local stores ESCC owns:
 *   - account-memory : the subject's own <id>.jsonl + <id>.md
 *   - observations    : instinct observation rows that reference the subject
 *   - instinct evidence: evidence lines that reference the subject (scrub); an
 *     instinct that references the subject in its trigger/action, or whose only
 *     remaining evidence was the subject's, is removed wholesale.
 *   - outbound state  : do-not-contact rows keyed to the subject + outbound
 *     governance rows whose payload references the subject (v1.1.0 approval
 *     tokens carry the recipient email — PII).
 *
 * NOT auto-erased — reported for manual handling, because shredding them would
 * over-erase unrelated subjects and ESCC cannot delete CRM rows:
 *   - the HubSpot record itself -> must go through crm-operator (sole writer);
 *   - session-data summaries that reference the subject among other accounts;
 *   - OTHER accounts' logs that merely mention the subject.
 *
 * Safety: DRY-RUN by default. Only confirm:true mutates — the --confirm flag is
 * the deletion approval gate (CLAUDE.md §5: approval required before deletes).
 * The scan is identical in both modes, so the dry-run report is exactly what a
 * subsequent confirm will do.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const accountMemory = require('./account-memory');
const identity = require('./account-identity');
const session = require('./session-manager');
const store = require('../instincts/instinct-store');
const notify = require('./notify');
const sessionSignal = require('./session-signal');

/*
 * Purge coverage doctrine (ADR-0019, D1): every JSONL store ESCC owns must
 * declare a purge strategy so a new store cannot silently escape erasure. The
 * content-guard test (tests/unit/content-guard-purge-coverage.test.js) asserts
 * every state-store TABLE_KEYS entry appears here. `auto:true` = rewritten in
 * place on --confirm (by canonical account key + JSON substring); `auto:false`
 * = either no per-subject identifier, or an aggregate whose auto-erasure would
 * over-erase unrelated subjects (scanned + reported for manual review instead).
 */
const PURGE_STRATEGIES = {
  // --- state-store tables (one entry per state-store TABLE_KEYS key) ---
  outcomes: { auto: true, reason: 'account_id canonical key (ADR-0018) + JSON substring; reply/fidelity outcome rows.' },
  promises: { auto: true, reason: 'account_id canonical key + JSON substring.' },
  work_items: { auto: true, reason: 'sourceId canonical key + JSON substring; morning-prep prepared-day items.' },
  governance_events: { auto: true, reason: 'JSON substring (approval tokens carry the recipient email — PII) + accountId.' },
  do_not_contact: { auto: true, reason: 'keyed by recipient (PII); JSON substring.' },
  forecast_snapshots: { auto: false, reason: 'aggregate multi-account rollup — auto-erasing a snapshot would over-erase unrelated subjects; scanned + reported for manual review, like session-data summaries.' },
  sessions: { auto: false, reason: 'session lifecycle metadata keyed by session id; no per-subject account identifier (session-data SUMMARY files are handled separately under manualReview.sessionFiles).' },
  skill_runs: { auto: false, reason: 'skill-invocation telemetry; no account identifiers.' },
  skill_versions: { auto: false, reason: 'skill version registry; no account data.' },
  decisions: { auto: false, reason: 'architectural decision log; no account data.' },
  install_state: { auto: false, reason: 'install-target state; no account data.' },
  // --- sidecar JSONL files (outside the state store) ---
  'notifications.jsonl': { auto: true, reason: 'notify queue rows carry account + free-text title/message; JSON substring rewrite.' },
  'session-outcomes.jsonl': { auto: true, reason: 'session follow-through metrics; JSON substring rewrite (rarely names a subject, scanned for safety).' },
};

// Identifiers shorter than this are refused: a 1-2 char substring (e.g. a
// ccTLD like "io") would over-erase unrelated subjects' data.
const MIN_IDENTIFIER_LENGTH = 3;

function matches(value, needleLower) {
  return String(value == null ? '' : value).toLowerCase().includes(needleLower);
}

/**
 * True only when the identifier is an EXACT comma-delimited token of applies_to.
 * applies_to is a segment/account filter list ("enterprise,mid-market"); a
 * substring match there would wrongly nuke a whole segment of instincts.
 */
function appliesToHasToken(appliesTo, idLower) {
  if (!appliesTo) return false;
  return String(appliesTo).toLowerCase().split(',').map(s => s.trim()).includes(idLower);
}

/** Active session-data dir + the legacy sessions/ dir (older installs). */
function sessionDirs() {
  const active = session.getSessionDataDir();
  return [active, path.join(path.dirname(active), 'sessions')];
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (_err) {
    return [];
  }
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_err) {
    return '';
  }
}

function atomicRewrite(file, contents) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

/** Read a JSONL table file into rows; tolerant of a missing file / torn lines. */
function readJsonl(file) {
  const rows = [];
  for (const line of safeRead(file).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch (_err) { /* skip torn line */ }
  }
  return rows;
}

/** Resolve the JSONL state directory (where do_not_contact / governance live). */
function stateDir() {
  try {
    return require('./state-store').resolveStateStorePath();
  } catch (_err) {
    return null;
  }
}

/**
 * Partition a JSONL file's rows into kept vs removed. A row is removed when its
 * canonical-key field (account_id / sourceId) resolves into the subject's
 * identity cluster, OR when the whole row JSON contains the identifier (the
 * substring fallback that catches deal ids, recipient emails, and free text).
 * Pure — never writes. @returns {{kept:object[], removed:number}}
 */
function partitionJsonl(file, { keyFields, stemSet, idLower }) {
  const kept = [];
  let removed = 0;
  if (!file || !idLower) return { kept, removed };
  for (const r of readJsonl(file)) {
    const keyHit = keyFields.some(f => r && stemSet.has(r[f]));
    if (keyHit || matches(JSON.stringify(r), idLower)) removed += 1;
    else kept.push(r);
  }
  return { kept, removed };
}

/** Resolve a path via a resolver that may throw; null on failure. */
function safeResolve(fn) {
  try {
    return fn();
  } catch (_err) {
    return null;
  }
}

/** Atomically rewrite `file` to `part.kept`, only when a row was removed. */
function rewriteKept(file, part) {
  if (file && part.removed > 0) {
    atomicRewrite(file, part.kept.map(r => JSON.stringify(r)).join('\n') + (part.kept.length ? '\n' : ''));
  }
}

/**
 * Scan + (optionally) erase a subject across the entity-scoped stores.
 * @param {{identifier:string, confirm?:boolean, options?:object}} args
 * @returns {{identifier, confirmed, erased, manualReview}}
 */
function purge(args = {}) {
  const id = String(args.identifier == null ? '' : args.identifier).trim();
  const confirm = !!args.confirm;
  const idLower = id.toLowerCase();

  // --- account-memory + voice: the subject's own files across the WHOLE
  // identity cluster (ADR-0018) — the canonical key, every alias pointing at
  // it, and the raw legacy stems. Purging "acme.example" must also reach the
  // company_12345 store it was linked to, and vice versa.
  const accountFiles = [];
  const ownPaths = new Set();
  const accDir = accountMemory.resolveAccountsDir();
  const voiceDir = path.join(path.dirname(path.dirname(accDir)), 'escc', 'voice', 'account');
  const stems = id ? identity.equivalentStems(id) : [];
  for (const s of stems) {
    for (const p of [
      path.join(accDir, `${s}.jsonl`),
      path.join(accDir, `${s}.md`),
      path.join(voiceDir, `${s}.md`),
    ]) {
      if (fs.existsSync(p) && !ownPaths.has(p)) {
        ownPaths.add(p);
        accountFiles.push(p);
      }
    }
  }

  // --- alias index: rows naming the subject (their alias/canonical stems ARE
  // identifying data) — filtered rewrite, like observations.
  const aliasFile = identity.aliasesFile();
  const aliasKept = [];
  let aliasRowsRemoved = 0;
  if (idLower) {
    const stemSet = new Set(stems);
    for (const r of readJsonl(aliasFile)) {
      const hit = (r && (stemSet.has(r.alias) || stemSet.has(r.canonical)))
        || matches(JSON.stringify(r), idLower);
      if (hit) aliasRowsRemoved += 1;
      else aliasKept.push(r);
    }
  }

  // --- account-memory: OTHER accounts that merely mention the subject (manual) -
  const accountReferences = [];
  for (const name of safeReaddir(accDir)) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(accDir, name);
    if (ownPaths.has(full)) continue;
    if (idLower && matches(safeRead(full), idLower)) accountReferences.push(full);
  }

  // --- observations: rows referencing the subject (filtered rewrite) ----------
  const allObs = store.readObservations();
  const keptObs = idLower ? allObs.filter(o => !matches(JSON.stringify(o), idLower)) : allObs.slice();
  const observationsRemoved = allObs.length - keptObs.length;

  // --- instincts: scrub evidence / remove wholesale ---------------------------
  const instinctsRemoved = [];
  const instinctsScrubbed = [];
  const toRemove = [];
  const toScrub = [];
  if (idLower) {
    for (const scope of ['personal', 'team']) {
      for (const inst of store.readInstincts(scope)) {
        const refsCore = matches(inst.trigger, idLower)
          || matches(inst.action, idLower)
          || matches(inst.id, idLower)
          || appliesToHasToken(inst.applies_to, idLower);
        const evidence = Array.isArray(inst.evidence) ? inst.evidence : [];
        const evidKept = evidence.filter(e => !matches(e, idLower));
        const evidDropped = evidence.length - evidKept.length;

        if (refsCore || (evidDropped > 0 && evidKept.length === 0)) {
          instinctsRemoved.push(inst.id);
          toRemove.push({ id: inst.id, scope });
        } else if (evidDropped > 0) {
          instinctsScrubbed.push(inst.id);
          toScrub.push({ inst, scope, evidKept });
        }
      }
    }
  }

  // --- outbound state: do-not-contact + outbound governance rows (PII) ---------
  const sdir = stateDir();
  const dncFile = sdir ? path.join(sdir, 'do_not_contact.jsonl') : null;
  const govFile = sdir ? path.join(sdir, 'governance_events.jsonl') : null;
  const dncKept = [];
  const govKept = [];
  let doNotContactRemoved = 0;
  let governanceRemoved = 0;
  if (idLower && dncFile) {
    for (const r of readJsonl(dncFile)) {
      if (matches(r && r.key, idLower) || matches(JSON.stringify(r), idLower)) doNotContactRemoved += 1;
      else dncKept.push(r);
    }
  }
  if (idLower && govFile) {
    // v1.1.0 approval/decision rows carry the recipient email — scrub any
    // governance row that references the subject.
    for (const r of readJsonl(govFile)) {
      if (matches(JSON.stringify(r), idLower)) governanceRemoved += 1;
      else govKept.push(r);
    }
  }

  // --- twin learning/prep stores (v1.9.0 writers, ADR-0019 D1) ---------------
  // outcomes / promises / work_items rewrite by canonical account key +
  // substring; two sidecar queues rewrite by substring. Forecast snapshots are
  // aggregate rollups -> reported for manual review, never auto-erased.
  const stemSet = new Set(stems);
  const outcomesFile = sdir ? path.join(sdir, 'outcomes.jsonl') : null;
  const promisesFile = sdir ? path.join(sdir, 'promises.jsonl') : null;
  const workItemsFile = sdir ? path.join(sdir, 'work_items.jsonl') : null;
  const forecastFile = sdir ? path.join(sdir, 'forecast_snapshots.jsonl') : null;
  const notificationsFile = safeResolve(() => notify.resolveQueuePath());
  const sessionOutcomesFile = safeResolve(() => sessionSignal.sessionOutcomesPath());

  const outcomesPart = partitionJsonl(outcomesFile, { keyFields: ['account_id'], stemSet, idLower });
  const promisesPart = partitionJsonl(promisesFile, { keyFields: ['account_id'], stemSet, idLower });
  const workItemsPart = partitionJsonl(workItemsFile, { keyFields: ['sourceId'], stemSet, idLower });
  const notificationsPart = partitionJsonl(notificationsFile, { keyFields: [], stemSet, idLower });
  const sessionOutcomesPart = partitionJsonl(sessionOutcomesFile, { keyFields: [], stemSet, idLower });

  let forecastSnapshotsReferencing = 0;
  if (idLower && forecastFile) {
    for (const r of readJsonl(forecastFile)) {
      if (matches(JSON.stringify(r), idLower)) forecastSnapshotsReferencing += 1;
    }
  }

  // --- session-data: summaries referencing the subject (manual review) --------
  // Scan the active session-data dir AND the legacy sessions/ dir (older installs).
  const sessionFiles = [];
  const seenSession = new Set();
  for (const sdir of sessionDirs()) {
    for (const name of safeReaddir(sdir)) {
      const full = path.join(sdir, name);
      if (seenSession.has(full)) continue;
      seenSession.add(full);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (_err) {
        continue;
      }
      if (!stat.isFile()) continue;
      if (idLower && matches(safeRead(full), idLower)) sessionFiles.push(full);
    }
  }

  // --- execute (only on confirm) ---------------------------------------------
  if (confirm) {
    for (const p of accountFiles) {
      try {
        fs.unlinkSync(p);
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
    }
    if (observationsRemoved > 0) {
      atomicRewrite(store.observationsPath(), keptObs.map(o => JSON.stringify(o)).join('\n') + (keptObs.length ? '\n' : ''));
    }
    for (const { id: rid, scope } of toRemove) store.removeInstinct(rid, scope);
    for (const { inst, scope, evidKept } of toScrub) store.writeInstinct({ ...inst, evidence: evidKept }, scope);
    if (doNotContactRemoved > 0) atomicRewrite(dncFile, dncKept.map(r => JSON.stringify(r)).join('\n') + (dncKept.length ? '\n' : ''));
    if (governanceRemoved > 0) atomicRewrite(govFile, govKept.map(r => JSON.stringify(r)).join('\n') + (govKept.length ? '\n' : ''));
    if (aliasRowsRemoved > 0) atomicRewrite(aliasFile, aliasKept.map(r => JSON.stringify(r)).join('\n') + (aliasKept.length ? '\n' : ''));
    rewriteKept(outcomesFile, outcomesPart);
    rewriteKept(promisesFile, promisesPart);
    rewriteKept(workItemsFile, workItemsPart);
    rewriteKept(notificationsFile, notificationsPart);
    rewriteKept(sessionOutcomesFile, sessionOutcomesPart);
  }

  return {
    identifier: id,
    confirmed: confirm,
    erased: {
      accountFiles,
      observationsRemoved,
      instinctsRemoved,
      instinctsScrubbed,
      doNotContactRemoved,
      governanceRemoved,
      aliasRowsRemoved,
      outcomesRemoved: outcomesPart.removed,
      promisesRemoved: promisesPart.removed,
      workItemsRemoved: workItemsPart.removed,
      notificationsRemoved: notificationsPart.removed,
      sessionOutcomesRemoved: sessionOutcomesPart.removed,
    },
    manualReview: {
      hubspot: `Erase the HubSpot record(s) for "${id}" via crm-operator — ESCC cannot delete CRM rows directly.`,
      sessionFiles,
      accountReferences,
      forecastSnapshotsReferencing,
    },
  };
}

function formatManifest(m) {
  const e = m.erased;
  const banner = m.confirmed
    ? `ERASED data for "${m.identifier}":`
    : `DRY RUN — privacy-purge plan for "${m.identifier}" (re-run with --confirm to erase):`;
  const lines = [
    banner,
    `  account files:        ${e.accountFiles.length}`,
    `  observations:         ${e.observationsRemoved}`,
    `  instincts removed:    ${e.instinctsRemoved.length}${e.instinctsRemoved.length ? ` (${e.instinctsRemoved.join(', ')})` : ''}`,
    `  instincts scrubbed:   ${e.instinctsScrubbed.length}${e.instinctsScrubbed.length ? ` (${e.instinctsScrubbed.join(', ')})` : ''}`,
    `  do-not-contact rows:  ${e.doNotContactRemoved || 0}`,
    `  outbound gov rows:    ${e.governanceRemoved || 0}`,
    `  identity alias rows:  ${e.aliasRowsRemoved || 0}`,
    `  outcome rows:         ${e.outcomesRemoved || 0}`,
    `  promise rows:         ${e.promisesRemoved || 0}`,
    `  work-item rows:       ${e.workItemsRemoved || 0}`,
    `  notification rows:    ${e.notificationsRemoved || 0}`,
    `  session-metric rows:  ${e.sessionOutcomesRemoved || 0}`,
    'Manual follow-up required (NOT auto-erased):',
    `  - ${m.manualReview.hubspot}`,
    `  - session-data references: ${m.manualReview.sessionFiles.length}`,
    `  - cross-referencing accounts: ${m.manualReview.accountReferences.length}`,
    `  - forecast snapshots referencing subject: ${m.manualReview.forecastSnapshotsReferencing || 0} (aggregate rollups — review manually)`,
  ];
  if (m.confirmed) {
    lines.push('Note: run privacy-purge when no active Claude Code session is writing to this workspace, so concurrent writes are not lost.');
  }
  return lines.join('\n');
}

/**
 * CLI-facing wrapper. Refuses an empty identifier; otherwise scans (and erases
 * when confirm:true). @returns {{code,text,data}}
 */
function runPurge(opts = {}) {
  const id = String(opts.identifier == null ? '' : opts.identifier).trim();
  if (!id) {
    return { code: 1, text: 'Refused: privacy-purge requires a non-empty <identifier> (account id, deal id, email, or domain).', data: null };
  }
  if (id.length < MIN_IDENTIFIER_LENGTH) {
    return { code: 1, text: `Refused: identifier "${id}" is too short to purge safely (min ${MIN_IDENTIFIER_LENGTH} characters) — a short substring would over-erase unrelated data.`, data: null };
  }
  const manifest = purge({ identifier: id, confirm: !!opts.confirm });
  return { code: 0, text: formatManifest(manifest), data: manifest };
}

module.exports = { purge, runPurge, formatManifest, PURGE_STRATEGIES };
