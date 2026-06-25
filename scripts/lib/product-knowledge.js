/*
 * ESCC product-knowledge retrieval ladder + ingest (NEW for ESCC; ADR-0012).
 *
 * The coded, deterministic retrieval ladder over the approved "what we sell"
 * knowledge layer (skills/product-knowledge), plus controlled-vocabulary +
 * candidate/gap ingest helpers. Mirrors scripts/lib/account-memory.js: a pure
 * synchronous CommonJS module, every path via resolveAgentDataHome, tolerant
 * reads (ENOENT -> []), atomic-ish appends.
 *
 * IMPORTANT (the firewall, per ADR-0012): this lib is a CONVENIENCE for
 * code-capable callers (the operator CLI, hooks, worklist). It is NOT the
 * drafter's enforcement. Prose-only drafting agents (Read/Grep/Glob, no code
 * execution) cannot call this; their guarantee is PHYSICAL SEPARATION — they are
 * pointed only at the approved store file and never at the candidate path. The
 * candidate reader here is operator-only.
 *
 * Storage under <ESCC_AGENT_DATA_HOME>/escc/product/:
 *   product-knowledge.json   approved entries (JSON array) — what drafters read
 *   candidate/candidates.jsonl  candidates (approved:false, untrusted:true) — operator-only
 *   gaps.jsonl               clean-miss gap log (role/segment/competitor/use-case)
 *
 * The controlled vocabulary ships committed at config/knowledge-vocab.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { resolveAgentDataHome } = require('./agent-data-home');
const { atomicWriteFile } = require('./utils');

const PRODUCT_SUBDIR = path.join('escc', 'product');
const APPROVED_FILE = 'product-knowledge.json';
const CANDIDATE_SUBDIR = 'candidate';
const CANDIDATE_FILE = 'candidates.jsonl';
const GAP_FILE = 'gaps.jsonl';

const DEFAULT_RETENTION_DAYS = 180;   // capability claims decay slowly
const DEFAULT_VOLATILE_DAYS = 60;     // battlecard + pain decay fast (ADR-0012)
const VOLATILE_TYPES = new Set(['battlecard', 'pain']);
const TYPES = ['value-prop', 'use-case', 'proof-point', 'claim', 'objection', 'pain', 'battlecard'];
const CAPABILITY_TYPES = new Set(['value-prop', 'use-case', 'proof-point', 'claim']);
const DAY_MS = 24 * 60 * 60 * 1000;

// --- paths ------------------------------------------------------------------

function resolveProductDir(options = {}) {
  return path.join(resolveAgentDataHome(options), PRODUCT_SUBDIR);
}
function approvedFile(options = {}) {
  return path.join(resolveProductDir(options), APPROVED_FILE);
}
function candidateFile(options = {}) {
  return path.join(resolveProductDir(options), CANDIDATE_SUBDIR, CANDIDATE_FILE);
}
function gapFile(options = {}) {
  return path.join(resolveProductDir(options), GAP_FILE);
}

/** Committed controlled-vocabulary path (ships with the plugin). */
function defaultVocabPath() {
  return path.join(__dirname, '..', '..', 'config', 'knowledge-vocab.json');
}

// --- small helpers ----------------------------------------------------------

/** Lowercase + trim a tag; undefined for empty/non-string. */
function norm(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim().toLowerCase();
  return s || undefined;
}

/** Comma-split an entry's segment into normalized industry tokens. */
function segmentTokens(entry) {
  if (!entry || typeof entry.segment !== 'string') return [];
  return entry.segment.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Coerce a date input (ISO string or ms) to epoch ms; NaN-safe -> now. */
function toMs(value) {
  if (value === undefined || value === null) return Date.now();
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? Date.now() : t;
}

/** Option > env > default, as a positive integer. */
function pickDays(optionValue, envName, fallback) {
  if (Number.isFinite(optionValue)) return optionValue;
  const env = Number(process.env[envName]);
  if (Number.isFinite(env) && env > 0) return env;
  return fallback;
}

// --- vocabulary -------------------------------------------------------------

/**
 * Load the controlled vocabulary. options.vocab (inline) > options.vocabPath >
 * committed config. Never throws — a missing/corrupt file degrades to a
 * general-only vocab so retrieval and role-resolution still work.
 */
function loadVocab(options = {}) {
  if (options.vocab && typeof options.vocab === 'object') return options.vocab;
  const p = options.vocabPath || defaultVocabPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_err) {
    /* fall through to the safe default */
  }
  return { version: 0, roles: ['general'], segments: ['general'], competitors: [], title_to_role: [], fallback_role: 'general' };
}

/**
 * Resolve a HubSpot job title to a controlled role (first-match-wins over the
 * vocab's title_to_role rules). Unknown/empty title -> fallback_role (general),
 * which still retrieves general proof. Never throws.
 */
function resolveRole(jobTitle, options = {}) {
  const vocab = loadVocab(options);
  const fallback = vocab.fallback_role || 'general';
  if (!jobTitle || typeof jobTitle !== 'string') return fallback;
  const title = jobTitle.trim().toLowerCase();
  if (!title) return fallback;
  for (const rule of vocab.title_to_role || []) {
    for (const keyword of rule.match || []) {
      if (keyword && title.includes(String(keyword).toLowerCase())) return rule.role;
    }
  }
  return fallback;
}

/**
 * Validate an entry's controlled-vocabulary tags (role / competitor / segment
 * tokens) against the vocab. The ingest gate (operator add/approve) calls this
 * so a free-text role can never enter and silently break the join.
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateVocabTags(entry, options = {}) {
  const vocab = loadVocab(options);
  const roles = new Set(vocab.roles || []);
  const segments = new Set(vocab.segments || []);
  const competitors = new Set(vocab.competitors || []);
  const errors = [];
  if (entry && entry.role != null && !roles.has(entry.role)) {
    errors.push(`role '${entry.role}' is not in the controlled vocabulary (config/knowledge-vocab.json)`);
  }
  if (entry && entry.competitor != null && !competitors.has(entry.competitor)) {
    errors.push(`competitor '${entry.competitor}' is not in the controlled vocabulary`);
  }
  if (entry && entry.segment != null) {
    for (const token of segmentTokens(entry)) {
      if (!segments.has(token)) errors.push(`segment '${token}' is not in the controlled vocabulary`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// --- store reads ------------------------------------------------------------

/**
 * Read the approved store. Tolerates a missing file ([]) and a corrupt JSON
 * blob ([]). DEFENSIVE FIREWALL: returns only rows that are approved:true and
 * not untrusted:true, so even if a bad row leaks into the approved file it can
 * never be surfaced to a caller.
 * @returns {object[]}
 */
function readApprovedFile(options = {}) {
  const file = approvedFile(options);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (_err) {
    return [];
  }
  return Array.isArray(arr) ? arr : [];
}

function readApproved(options = {}) {
  return readApprovedFile(options).filter(e => e && typeof e === 'object' && e.approved === true && e.untrusted !== true);
}

/**
 * Read the candidate store (operator-only). JSONL; tolerates a missing file and
 * skips corrupt lines. No drafting path calls this (firewall: ADR-0012).
 * @returns {object[]}
 */
function readCandidates(options = {}) {
  const file = candidateFile(options);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch (_err) { /* skip torn line */ }
  }
  return out;
}

/**
 * Append a candidate. FORCES approved:false + untrusted:true so a miner or
 * operator can never accidentally write an approved/trusted candidate. Fills id
 * + created_at when absent. Returns the stored row.
 */
function appendCandidate(entry, options = {}) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('product-knowledge.appendCandidate: entry must be an object');
  }
  const file = candidateFile(options);
  const stored = {
    id: entry.id || `CAND-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    created_at: entry.created_at || new Date().toISOString(),
    ...entry,
    approved: false,
    untrusted: true,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(stored)}\n`);
  return stored;
}

// --- freshness --------------------------------------------------------------

/** Max age (days) before an entry of this type is stale. battlecard/pain decay faster. */
function maxAgeDays(type, options = {}) {
  if (VOLATILE_TYPES.has(type)) {
    return pickDays(options.volatileDays, 'ESCC_KNOWLEDGE_VOLATILE_DAYS', DEFAULT_VOLATILE_DAYS);
  }
  return pickDays(options.retentionDays, 'ESCC_MEMORY_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
}

/**
 * Is an entry fresh enough to quote as a stated fact? An entry with no
 * last_verified, an unparseable date, or one past its type's re-verify cadence
 * is NOT fresh (it is a hypothesis, not a fact).
 */
function isFresh(entry, now, options = {}) {
  if (!entry || !entry.last_verified) return false;
  const verified = Date.parse(entry.last_verified);
  if (Number.isNaN(verified)) return false;
  const ageDays = (toMs(now) - verified) / DAY_MS;
  return ageDays <= maxAgeDays(entry.type, options);
}

// --- the ladder -------------------------------------------------------------

/** An entry is eligible for a query only if it does not CONTRADICT a set key. */
function isEligible(entry, q) {
  if (q.type) {
    const types = Array.isArray(q.type) ? q.type : [q.type];
    if (!types.includes(entry.type)) return false;
  }
  if (q.competitor && entry.competitor && entry.competitor !== q.competitor) return false;
  // A role-tagged entry for a DIFFERENT specific role must not surface; a
  // general-role (or untagged) entry stays eligible as the fallback.
  if (q.role && entry.role && entry.role !== q.role && entry.role !== 'general') return false;
  if (q.segment && typeof entry.segment === 'string') {
    const tokens = segmentTokens(entry);
    if (tokens.length && !tokens.includes(q.segment) && !tokens.includes('general')) return false;
  }
  return true;
}

/** Specificity score: competitor 4, role 2, segment 1 (unique per subset). */
function scoreEntry(entry, q) {
  let s = 0;
  if (q.competitor && entry.competitor === q.competitor) s += 4;
  if (q.role && entry.role === q.role) s += 2;
  if (q.segment && segmentTokens(entry).includes(q.segment)) s += 1;
  return s;
}

/** role+segment+competitor naming derived from the (unique) score bits. */
function labelFromScore(s) {
  const parts = [];
  if (s & 2) parts.push('role');
  if (s & 1) parts.push('segment');
  if (s & 4) parts.push('competitor');
  return parts.length ? parts.join('+') : 'general';
}

function describeSlot(q) {
  const parts = [];
  if (q.role) parts.push(`role=${q.role}`);
  if (q.segment) parts.push(`segment=${q.segment}`);
  if (q.competitor) parts.push(`competitor=${q.competitor}`);
  if (q.type) parts.push(`type=${Array.isArray(q.type) ? q.type.join('|') : q.type}`);
  if (q.useCase) parts.push(`use-case=${q.useCase}`);
  return parts.length ? parts.join(' ') : 'this slot';
}

/**
 * Retrieve the most-specific APPROVED + FRESH proof for a slot, falling back
 * role+segment+competitor -> role+segment -> segment -> general. Always returns
 * a result object; NEVER throws. On a clean miss, returns an explicit "no
 * approved proof" sentinel (so the caller says so instead of inventing) and
 * logs a gap (unless options.logGap === false).
 *
 * @param {{role?,segment?,competitor?,type?,useCase?}} query
 * @returns {{found, tier, score, entries, stale, sentinel, query}}
 */
function retrieve(query = {}, options = {}) {
  const q = {
    role: norm(query.role),
    segment: norm(query.segment),
    competitor: norm(query.competitor),
    type: query.type,
    useCase: query.useCase || query.use_case || null,
  };

  let approved;
  try {
    approved = readApproved(options);
  } catch (_err) {
    approved = []; // never throw: a read error degrades to a clean miss
  }

  const eligible = approved.filter(e => isEligible(e, q));
  const fresh = [];
  const stale = [];
  for (const e of eligible) (isFresh(e, options.now, options) ? fresh : stale).push(e);

  let tier = null;
  let score = null;
  let entries = [];
  if (fresh.length) {
    let max = -1;
    for (const e of fresh) { const s = scoreEntry(e, q); if (s > max) max = s; }
    score = max;
    tier = labelFromScore(max);
    entries = fresh.filter(e => scoreEntry(e, q) === max);
  }

  const found = entries.length > 0;
  let sentinel = null;
  if (!found) {
    sentinel = `no approved proof for ${describeSlot(q)}`;
    if (options.logGap !== false) logGap(q, options);
  }
  return { found, tier, score: found ? score : null, entries, stale, sentinel, query: q };
}

// --- gap log ----------------------------------------------------------------

/** Append a clean-miss gap (best-effort; never throws — gap logging must not break retrieval). */
function logGap(slot = {}, options = {}) {
  try {
    const file = gapFile(options);
    const row = {
      ts: new Date(toMs(options.now)).toISOString(),
      role: norm(slot.role) || null,
      segment: norm(slot.segment) || null,
      competitor: norm(slot.competitor) || null,
      use_case: slot.useCase || slot.use_case || null,
      type: slot.type || null,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    return row;
  } catch (_err) {
    return null;
  }
}

/** Read the gap log (for `escc product gaps`). Tolerant; skips corrupt lines. */
function readGaps(options = {}) {
  const file = gapFile(options);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch (_err) { /* skip */ }
  }
  return out;
}

// --- ingest / promotion (operator-gated) ------------------------------------

/**
 * Minimal shape check mirroring schemas/product-knowledge.schema.json, kept in
 * code so the runtime ingest stays ajv-free (per the optional-ajv hardening);
 * the committed schema + its disk-loading test remain the authority for shipped
 * artifacts. @returns {string[]} errors (empty == ok)
 */
function requiredFieldErrors(entry) {
  if (!entry || typeof entry !== 'object') return ['entry must be an object'];
  const e = [];
  if (!entry.id) e.push('id is required');
  if (!entry.type) e.push('type is required');
  else if (!TYPES.includes(entry.type)) e.push(`type '${entry.type}' is not a known type`);
  if (!entry.source_type) e.push('source_type is required');
  const t = entry.type;
  if (CAPABILITY_TYPES.has(t) && !entry.text) e.push(`${t} requires text`);
  if (t === 'objection' && (!entry.pattern || !entry.response)) e.push('objection requires pattern + response');
  if (t === 'pain' && (!entry.role || !entry.text)) e.push('pain requires role + text');
  if (t === 'battlecard' && (!entry.competitor || !entry.differentiation || !entry.guardrail)) e.push('battlecard requires competitor + differentiation + guardrail');
  if (entry.approved === true && entry.untrusted === true) e.push('an approved entry can never be untrusted (firewall)');
  return e;
}

/** Atomically rewrite the approved store array. */
function writeApproved(entries, options = {}) {
  fs.mkdirSync(resolveProductDir(options), { recursive: true });
  atomicWriteFile(approvedFile(options), `${JSON.stringify(entries, null, 2)}\n`);
}

/** Atomically rewrite the candidate JSONL (used after a promotion). */
function writeCandidates(entries, options = {}) {
  const file = candidateFile(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = entries.map(e => JSON.stringify(e)).join('\n');
  atomicWriteFile(file, entries.length ? `${body}\n` : '');
}

/**
 * Add an APPROVED entry — the human gate: requires approved_by (the person
 * vouching). Validates shape + controlled-vocab tags + rejects approved+untrusted.
 * @returns {{ok: boolean, errors: string[], entry: object|null}}
 */
function addApproved(entry, options = {}) {
  const approvedBy = options.approvedBy || (entry && entry.approved_by);
  const errors = requiredFieldErrors({ ...entry, approved: true });
  errors.push(...validateVocabTags(entry || {}, options).errors);
  if (!approvedBy) errors.push('approved_by is required to add an approved entry (the human gate)');
  if (errors.length) return { ok: false, errors, entry: null };
  const stored = {
    ...entry,
    approved: true,
    untrusted: false,
    approved_by: approvedBy,
    last_verified: entry.last_verified || new Date(toMs(options.now)).toISOString().slice(0, 10),
  };
  const arr = readApprovedFile(options);
  arr.push(stored);
  writeApproved(arr, options);
  return { ok: true, errors: [], entry: stored };
}

/**
 * Promote a candidate (by id) to the approved store — the operator-only human
 * gate. Clears untrusted, requires approved_by, validates, then removes the
 * promoted row from the candidate area.
 * @returns {{ok: boolean, errors: string[], entry: object|null}}
 */
function approveCandidate(id, options = {}) {
  if (!options.approvedBy) return { ok: false, errors: ['approved_by is required to promote a candidate'], entry: null };
  const candidates = readCandidates(options);
  const idx = candidates.findIndex(c => c && c.id === id);
  if (idx < 0) return { ok: false, errors: [`no candidate with id '${id}'`], entry: null };
  const promoted = { ...candidates[idx] };
  delete promoted.untrusted;
  const res = addApproved(promoted, options);
  if (!res.ok) return res;
  writeCandidates(candidates.filter((_, i) => i !== idx), options);
  return { ok: true, errors: [], entry: res.entry };
}

module.exports = {
  // paths
  resolveProductDir,
  approvedFile,
  candidateFile,
  gapFile,
  defaultVocabPath,
  // vocabulary
  loadVocab,
  resolveRole,
  validateVocabTags,
  // reads / ingest
  readApproved,
  readApprovedFile,
  readCandidates,
  appendCandidate,
  requiredFieldErrors,
  writeApproved,
  writeCandidates,
  addApproved,
  approveCandidate,
  // retrieval
  retrieve,
  isFresh,
  // gap log
  logGap,
  readGaps,
  // helpers (exported for tests / callers)
  segmentTokens,
  scoreEntry,
  labelFromScore,
  // constants
  TYPES,
  VOLATILE_TYPES,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_VOLATILE_DAYS,
};
