/*
 * ESCC instinct LIFECYCLE (NEW for ESCC; concept adapted from ECC
 * continuous-learning-v2 — ESCC does a Node rewrite, deps = ajv only).
 *
 * The post-distillation maintenance of the instinct library:
 *   I4  decay      — time-based confidence decay (faster for volatile sales
 *                    domains), plus confirm/contradict adjustments; a swept
 *                    instinct below the retire floor is removed. Seeds and
 *                    decay_exempt instincts never decay.
 *   I5  promotion  — personal -> team NEVER happens automatically; it requires
 *                    an explicit, manager-role-checked call.
 *   I6  evolve     — a domain graduates to an evolved artifact only at a pinned
 *                    threshold (>=3 instincts, avg confidence >=0.7); the draft
 *                    carries `provenance: evolved` so it is routed through the
 *                    same validators as curated content.
 *   I7  review     — reject removes an instinct and records its id (so distill
 *                    never resurrects it); approve clears it from pending review.
 *
 * All functions are pure with respect to their inputs (they return new objects)
 * and read/write the instinct library only through instinct-store.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const store = require('./instinct-store');

// --- tunables ---------------------------------------------------------------

// Per-week confidence decay by domain. Volatile, fast-moving sales domains
// (what worked last quarter may not work now) decay faster than durable process
// / preference instincts.
const DECAY_RATE = { outreach: 0.03, deals: 0.03, crm: 0.03, process: 0.02, preferences: 0.02 };
const DEFAULT_DECAY_RATE = 0.02;

const CONF_FLOOR = 0; // decay may drive confidence toward 0 (retirement)
const CONF_MAX = 0.9; // nominal ceiling
const RETIRE_FLOOR = 0.2; // after a sweep, anything below this is retired
const CONFIRM_STEP = 0.05;
const CONTRADICT_STEP = 0.1;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Evolve graduation threshold (I6 — pinned, not heuristic).
const EVOLVE_MIN_COUNT = 3;
const EVOLVE_MIN_AVG_CONFIDENCE = 0.7;

// Roles permitted to promote personal -> team (I5).
const MANAGER_ROLES = new Set(['manager', 'sales-manager', 'sales_manager', 'revops', 'rev-ops', 'admin', 'vp', 'cro']);

// --- helpers ----------------------------------------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function weeksBetween(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / WEEK_MS);
}

// --- I4 decay ---------------------------------------------------------------

/**
 * Decay one instinct's confidence by the elapsed weeks since it was last
 * observed. decay_exempt instincts (seeds, safety) are returned unchanged.
 * @returns {object} a new instinct object
 */
function decayInstinct(instinct, { now } = {}) {
  if (!instinct || instinct.decay_exempt) return { ...instinct };
  const since = instinct.last_observed || instinct.created;
  const weeks = weeksBetween(since, now);
  if (weeks === 0) return { ...instinct };
  const rate = DECAY_RATE[instinct.domain] ?? DEFAULT_DECAY_RATE;
  const confidence = round2(clamp(instinct.confidence - weeks * rate, CONF_FLOOR, CONF_MAX));
  return { ...instinct, confidence };
}

/** Confirmation event: +CONFIRM_STEP (capped). Optionally stamps last_observed. */
function applyConfirmation(instinct, { now } = {}) {
  const confidence = round2(clamp(instinct.confidence + CONFIRM_STEP, CONF_FLOOR, CONF_MAX));
  return { ...instinct, confidence, last_observed: now || instinct.last_observed };
}

/** Contradiction event: -CONTRADICT_STEP (floored). Optionally stamps last_observed. */
function applyContradiction(instinct, { now } = {}) {
  const confidence = round2(clamp(instinct.confidence - CONTRADICT_STEP, CONF_FLOOR, CONF_MAX));
  return { ...instinct, confidence, last_observed: now || instinct.last_observed };
}

/**
 * Decay every instinct in a scope, writing back changes and retiring (deleting)
 * any that fall below the retire floor. Runs in the SessionStart sweep.
 * @returns {{updated: string[], retired: string[]}}
 */
function decaySweep({ now, scope = 'personal' } = {}) {
  const updated = [];
  const retired = [];
  const failed = [];
  for (const instinct of store.readInstincts(scope)) {
    // Guard each instinct: one that fails to re-validate (e.g. a corrupt field
    // from an older version) must not abort the whole sweep at SessionStart.
    try {
      const decayed = decayInstinct(instinct, { now });
      if (!instinct.decay_exempt && decayed.confidence < RETIRE_FLOOR) {
        store.removeInstinct(instinct.id, scope);
        retired.push(instinct.id);
        continue;
      }
      if (decayed.confidence !== instinct.confidence) {
        // Advance the decay anchor to `now` so a later sweep measures only the
        // time elapsed SINCE this one. Without this, every SessionStart sweep
        // would re-apply decay from the original last_observed and compound it
        // (five sessions in a week => ~five weeks of decay). last_observed
        // already denotes "last engine touch" — distill re-stamps it on every
        // redistill — so advancing it here is consistent, not a semantic change.
        const anchored = now ? { ...decayed, last_observed: now } : decayed;
        store.writeInstinct(anchored);
        updated.push(instinct.id);
      }
    } catch (_err) {
      failed.push(instinct.id);
    }
  }
  return { updated, retired, failed };
}

// --- I5 promotion -----------------------------------------------------------

/** Resolve the operator role from env when not passed explicitly. */
function resolveRole(explicit) {
  const raw = (explicit || process.env.ESCC_ROLE || process.env.ESCC_REP_ROLE || 'rep');
  return String(raw).trim().toLowerCase();
}

function isManagerRole(role) {
  return MANAGER_ROLES.has(resolveRole(role));
}

/**
 * Promote a personal instinct to team scope. Manager-gated: refused for any
 * non-manager role. There is NO automatic promotion path anywhere in the engine.
 * @returns {{promoted: boolean, id?: string, reason?: string}}
 */
function promoteInstinct(id, { role, fromScope = 'personal' } = {}) {
  if (!isManagerRole(role)) return { promoted: false, reason: 'role_required' };
  const source = store.readInstincts(fromScope).find(i => i.id === id);
  if (!source) return { promoted: false, reason: 'not_found' };
  store.writeInstinct({ ...source, scope: 'team' });
  store.removeInstinct(id, fromScope);
  return { promoted: true, id };
}

// --- I6 evolve --------------------------------------------------------------

/**
 * Domains ready to graduate into an evolved artifact.
 * @returns {Array<{domain: string, instincts: object[], avgConfidence: number, count: number}>}
 */
function findEvolutionCandidates({ scope = 'personal', minCount = EVOLVE_MIN_COUNT, minAvgConfidence = EVOLVE_MIN_AVG_CONFIDENCE } = {}) {
  const byDomain = new Map();
  for (const instinct of store.readInstincts(scope)) {
    if (!byDomain.has(instinct.domain)) byDomain.set(instinct.domain, []);
    byDomain.get(instinct.domain).push(instinct);
  }
  const candidates = [];
  for (const [domain, instincts] of byDomain) {
    if (instincts.length < minCount) continue;
    const avg = instincts.reduce((s, i) => s + (i.confidence || 0), 0) / instincts.length;
    if (avg < minAvgConfidence) continue;
    candidates.push({ domain, instincts, avgConfidence: round2(avg), count: instincts.length });
  }
  return candidates;
}

/** Render an evolved-skill DRAFT (frontmatter + body) for a candidate domain. */
function draftEvolvedSkill(candidate, { now } = {}) {
  const name = `${candidate.domain}-evolved-playbook`;
  const lines = [
    '---',
    `name: ${name}`,
    `description: Use when ${DOMAIN_CONTEXT(candidate.domain)} — evolved from ${candidate.count} high-confidence ${candidate.domain} instincts (avg ${candidate.avgConfidence}). DRAFT, pending review.`,
    'provenance: evolved',
    'origin: ESCC',
    `domain: ${candidate.domain}`,
    `created: ${now || new Date().toISOString()}`,
    '---',
    '',
    `# ${candidate.domain} — evolved playbook (DRAFT)`,
    '',
    '> Auto-evolved from high-confidence instincts. Route this through the same',
    '> frontmatter + content-guard + CI validators as curated skills, and diff it',
    '> against compliance rules, before it is treated as an active skill.',
    '',
    '## Constituent instincts',
  ];
  for (const i of candidate.instincts) {
    lines.push(`- \`${i.id}\` (confidence ${i.confidence}) — ${i.action || i.trigger || ''}`.trimEnd());
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

function DOMAIN_CONTEXT(domain) {
  return {
    outreach: 'drafting or sending outreach',
    deals: 'working an open deal',
    crm: 'updating the CRM',
    process: 'doing sales work',
    preferences: 'producing rep-facing output',
  }[domain] || 'doing sales work';
}

/**
 * Write an evolved-skill draft for every qualifying domain.
 * @returns {{candidates: object[], wrote: string[]}}
 */
function evolve({ now, scope = 'personal' } = {}) {
  const candidates = findEvolutionCandidates({ scope });
  const dir = store.evolvedDir('skills');
  const wrote = [];
  const failed = [];
  if (candidates.length) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_err) { /* per-candidate guard reports below */ }
  }
  for (const candidate of candidates) {
    // Guard each write so one I/O failure doesn't abandon the rest (fail-open).
    const file = path.join(dir, `${candidate.domain}-evolved-playbook.md`);
    try {
      fs.writeFileSync(file, draftEvolvedSkill(candidate, { now }), 'utf8');
      wrote.push(file);
    } catch (_err) {
      failed.push(candidate.domain);
    }
  }
  return { candidates, wrote, failed };
}

// --- I7 review gate ---------------------------------------------------------

/** Reject an instinct: remove it and record its id so distill cannot resurrect it. */
function rejectInstinct(id, { scope = 'personal' } = {}) {
  store.removeInstinct(id, scope);
  store.addIdToRegistry('rejected', id);
  return { rejected: true, id };
}

/** Approve an instinct: record its id so it drops off the pending-review list. */
function approveInstinct(id) {
  store.addIdToRegistry('approved', id);
  return { approved: true, id };
}

/** Instincts in a scope that a human has not yet approved (pending review). */
function listForReview({ scope = 'personal' } = {}) {
  const approved = new Set(store.readIdRegistry('approved'));
  return store.readInstincts(scope).filter(i => !approved.has(i.id));
}

module.exports = {
  DECAY_RATE,
  RETIRE_FLOOR,
  EVOLVE_MIN_COUNT,
  EVOLVE_MIN_AVG_CONFIDENCE,
  decayInstinct,
  applyConfirmation,
  applyContradiction,
  decaySweep,
  resolveRole,
  isManagerRole,
  promoteInstinct,
  findEvolutionCandidates,
  draftEvolvedSkill,
  evolve,
  rejectInstinct,
  approveInstinct,
  listForReview,
};
