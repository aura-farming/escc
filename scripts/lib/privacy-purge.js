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
const session = require('./session-manager');
const store = require('../instincts/instinct-store');

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
 * Scan + (optionally) erase a subject across the entity-scoped stores.
 * @param {{identifier:string, confirm?:boolean, options?:object}} args
 * @returns {{identifier, confirmed, erased, manualReview}}
 */
function purge(args = {}) {
  const id = String(args.identifier == null ? '' : args.identifier).trim();
  const confirm = !!args.confirm;
  const idLower = id.toLowerCase();

  // --- account-memory: the subject's own files (entity-scoped, erasable) ------
  const accountFiles = [];
  const stem = id ? accountMemory.sanitizeAccountId(id) : null;
  let ownJsonl = null;
  if (stem) {
    ownJsonl = accountMemory.accountFile(id);
    for (const p of [ownJsonl, accountMemory.markdownFile(id)]) {
      if (fs.existsSync(p)) accountFiles.push(p);
    }
  }

  // --- account-memory: OTHER accounts that merely mention the subject (manual) -
  const accountReferences = [];
  const accDir = accountMemory.resolveAccountsDir();
  for (const name of safeReaddir(accDir)) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(accDir, name);
    if (full === ownJsonl) continue;
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
  }

  return {
    identifier: id,
    confirmed: confirm,
    erased: { accountFiles, observationsRemoved, instinctsRemoved, instinctsScrubbed, doNotContactRemoved, governanceRemoved },
    manualReview: {
      hubspot: `Erase the HubSpot record(s) for "${id}" via crm-operator — ESCC cannot delete CRM rows directly.`,
      sessionFiles,
      accountReferences,
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
    'Manual follow-up required (NOT auto-erased):',
    `  - ${m.manualReview.hubspot}`,
    `  - session-data references: ${m.manualReview.sessionFiles.length}`,
    `  - cross-referencing accounts: ${m.manualReview.accountReferences.length}`,
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

module.exports = { purge, runPurge, formatManifest };
