/*
 * ESCC instinct DISTILL (NEW for ESCC; concept adapted from ECC
 * continuous-learning-v2's instinct-cli.py analyze step — ESCC does a Node
 * rewrite, deps = ajv only).
 *
 * Turns the append-only observation log into drafted instincts:
 *   1. derive trusted SIGNALS from observations (corrections, user-initiated
 *      tool sequences, error resolutions),
 *   2. cluster signals by a stable key and count frequency,
 *   3. draft an instinct per cluster that meets its threshold,
 *   4. weight each draft's confidence by REAL outcomes (I2), then write it.
 *
 * I2  Confidence MOVES on real `outcome` events read from the state store, not
 *     on raw frequency. Frequency only sets a tentative baseline.
 * I3  Signals are derived ONLY from trusted observations — anything tagged
 *     untrusted:true, or carrying tool-OUTPUT content (kind 'tool_output'), is
 *     dropped before derivation. A prompt-injection in a prospect email can
 *     therefore never become a learned behavior.
 *
 * Distillation is idempotent: it recomputes candidates from the full observation
 * history each run, preserving an existing instinct's `created` timestamp and
 * decay-exempt flag, and skips human-rejected ids (I7 forward-compat).
 */

'use strict';

const crypto = require('crypto');

const instinctStore = require('./instinct-store');

// --- tunables (named, not magic) --------------------------------------------

// Minimum clustered occurrences before a signal of each kind becomes a draft.
const THRESHOLDS = { user_correction: 1, error_resolution: 2, tool_sequence: 3 };

// Tentative confidence a draft starts at, by signal kind (before outcome moves it).
const BASE_CONFIDENCE = { user_correction: 0.5, error_resolution: 0.4, tool_sequence: 0.4 };

const CONF_MIN = 0.3; // nominal floor; the I4 decay sweep may push below this later
const CONF_MAX = 0.9; // nominal ceiling
const FREQ_STEP = 0.02; // tiny nudge per extra occurrence above threshold
const FREQ_STEP_CAP = 5; // …capped, so frequency never dominates outcomes
const OUTCOME_STEP = 0.05; // I2: confirmation per matching real outcome
const OUTCOME_CAP = 6; // …capped
const MAX_EVIDENCE = 8;
const ACTION_SLUG_MAX = 48;

// A real outcome confirms instincts in this domain (I2).
const OUTCOME_DOMAIN = {
  reply_received: 'outreach',
  sequence_step_engaged: 'outreach',
  meeting_booked: 'outreach',
  deal_stage_advanced: 'deals',
  closed_won: 'deals',
  closed_lost: 'deals',
};

// Keyword → domain inference for free-text corrections (first match wins).
const DOMAIN_RULES = [
  [/(subject|cold email|outreach|sequence|cadence|open rate|repl(y|ies)|inbox|trigger)/i, 'outreach'],
  [/(deal|stage|forecast|close|meddpicc|pipeline|champion|opportunit)/i, 'deals'],
  [/(\blog\b|hubspot|crm|activity|disposition|property|record)/i, 'crm'],
  [/(prefer|tone|style|voice|format|always use|never use)/i, 'preferences'],
];

// Human-readable activation context per domain (used as a correction's trigger).
const DOMAIN_CONTEXT = {
  outreach: 'drafting or sending outreach',
  deals: 'working an open deal',
  crm: 'updating the CRM',
  process: 'doing sales work',
  preferences: 'producing rep-facing output',
};

// --- small helpers -----------------------------------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n)}...` : str;
}

function slugify(text, max = ACTION_SLUG_MAX) {
  const s = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/, '');
}

function normalizeKey(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function shortHash(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
}

function inferDomain(text) {
  for (const [re, domain] of DOMAIN_RULES) {
    if (re.test(text)) return domain;
  }
  return 'process';
}

// --- signal derivation (I3 enforced here) -----------------------------------

/** True only for observations safe to learn from. */
function isDerivable(observation) {
  return Boolean(observation)
    && observation.untrusted !== true
    && observation.kind !== 'tool_output';
}

function groupBySession(rows) {
  const map = new Map();
  for (const row of rows) {
    const sid = row.session_id;
    if (!sid) continue; // a real session id is required to trust ordering
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(row);
  }
  return map;
}

/**
 * Derive trusted signals from the observation log. Untrusted / tool-output
 * observations are dropped up front, so no signal can originate from them (I3).
 * @param {object[]} observations
 * @returns {object[]} signals: { kind, key, domain, trigger, action, evidence[] }
 */
function deriveSignals(observations) {
  const trusted = (observations || []).filter(isDerivable);
  const signals = [];

  // 1. Explicit user corrections — the strongest, most direct signal.
  for (const o of trusted) {
    if (o.kind !== 'user_correction') continue;
    const text = String(o.text || '').trim();
    if (!text) continue;
    const domain = inferDomain(text);
    signals.push({
      kind: 'user_correction',
      key: `corr:${normalizeKey(text)}`,
      domain,
      trigger: `when ${DOMAIN_CONTEXT[domain]}`,
      action: text,
      evidence: [`rep correction: "${truncate(text, 120)}"`],
    });
  }

  // 2. User-initiated tool sequences + error resolutions, per session, in order.
  const bySession = groupBySession(trusted.filter(o => o.kind === 'tool_use' && o.event === 'post'));
  for (const [sid, rows] of bySession) {
    for (let i = 0; i + 1 < rows.length; i += 1) {
      const a = rows[i];
      const b = rows[i + 1];
      if (!a.tool || !b.tool || a.tool === b.tool) continue;
      if (a.error) {
        if (!b.error) {
          signals.push({
            kind: 'error_resolution',
            key: `fix:${a.tool}>${b.tool}`,
            domain: 'process',
            trigger: `after ${a.tool} fails`,
            action: `recover by running ${b.tool}`,
            evidence: [`${a.tool} errored, then ${b.tool} succeeded (session ${sid})`],
          });
        }
        continue;
      }
      if (b.error) continue; // never learn a sequence that ended in an error
      signals.push({
        kind: 'tool_sequence',
        key: `seq:${a.tool}>${b.tool}`,
        domain: 'process',
        trigger: `after running ${a.tool}`,
        action: `follow with ${b.tool}`,
        evidence: [`${a.tool} -> ${b.tool} (session ${sid})`],
      });
    }
  }

  return signals;
}

/** Group signals by key, counting occurrences and accumulating deduped evidence. */
function clusterSignals(signals) {
  const byKey = new Map();
  for (const s of signals) {
    if (!byKey.has(s.key)) {
      byKey.set(s.key, { kind: s.kind, key: s.key, domain: s.domain, trigger: s.trigger, action: s.action, count: 0, evidence: [] });
    }
    const c = byKey.get(s.key);
    c.count += 1;
    for (const e of s.evidence) {
      if (c.evidence.length < MAX_EVIDENCE && !c.evidence.includes(e)) c.evidence.push(e);
    }
  }
  return [...byKey.values()];
}

// --- drafting + outcome weighting -------------------------------------------

function frequencyConfidence(cluster) {
  const base = BASE_CONFIDENCE[cluster.kind] ?? 0.4;
  const over = Math.max(0, cluster.count - (THRESHOLDS[cluster.kind] ?? 1));
  return clamp(base + Math.min(over, FREQ_STEP_CAP) * FREQ_STEP, CONF_MIN, CONF_MAX);
}

function instinctId(cluster) {
  if (cluster.kind === 'user_correction') {
    const slug = slugify(cluster.action);
    if (slug) return slug;
  }
  const keySlug = slugify(cluster.key);
  if (keySlug) return keySlug;
  return `instinct-${shortHash(cluster.key)}`;
}

/**
 * Draft an instinct from a cluster, preserving an existing draft's `created`
 * timestamp and decay-exempt flag so re-distillation is non-destructive.
 */
function draftFromCluster(cluster, { now, existing }) {
  const id = instinctId(cluster);
  const prior = existing && existing.get(id);
  return {
    id,
    trigger: cluster.trigger || `when ${DOMAIN_CONTEXT[cluster.domain] || 'doing sales work'}`,
    confidence: round2(frequencyConfidence(cluster)),
    domain: cluster.domain,
    scope: 'personal',
    source: cluster.kind,
    applies_to: null,
    created: (prior && prior.created) || now,
    last_observed: now,
    decay_exempt: prior ? Boolean(prior.decay_exempt) : false,
    action: cluster.action || '',
    evidence: cluster.evidence.slice(0, MAX_EVIDENCE),
  };
}

/**
 * I2: move confidence by REAL outcomes. Each outcome whose mapped domain equals
 * the instinct's domain confirms it (+OUTCOME_STEP, capped). Returns a new
 * instinct object; never mutates the input.
 */
function applyOutcomeWeighting(instinct, outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return { ...instinct };
  let matches = 0;
  for (const o of outcomes) {
    if (o && OUTCOME_DOMAIN[o.type] === instinct.domain) matches += 1;
  }
  if (matches === 0) return { ...instinct };
  const confidence = round2(clamp(instinct.confidence + Math.min(matches, OUTCOME_CAP) * OUTCOME_STEP, CONF_MIN, CONF_MAX));
  return { ...instinct, confidence };
}

// --- orchestration -----------------------------------------------------------

/**
 * Run a full distillation pass.
 * @param {object} [opts]
 * @param {object} [opts.store]        state store exposing listOutcomes() (I2). Omitted -> no outcomes.
 * @param {string[]} [opts.rejectedIds] instinct ids a human rejected (I7) — never re-drafted.
 * @param {string} [opts.now]          ISO timestamp for created/last_observed (injectable for tests).
 * @param {boolean} [opts.dryRun]      compute drafts without writing them.
 * @returns {{drafted: object[], wrote: string[]}}
 */
function distill(opts = {}) {
  const now = opts.now || new Date().toISOString();
  // Honor both the caller's list and the persisted reject registry (I7), so a
  // human rejection sticks across runs without the caller re-supplying it.
  const rejected = new Set(opts.rejectedIds || []);
  try {
    for (const id of instinctStore.readIdRegistry('rejected')) rejected.add(id);
  } catch (_err) {
    // a missing/corrupt registry must never abort distillation
  }

  const observations = instinctStore.readObservations();
  const clusters = clusterSignals(deriveSignals(observations));
  const existing = new Map(instinctStore.readInstincts('personal').map(i => [i.id, i]));

  let outcomes = [];
  try {
    if (opts.store && typeof opts.store.listOutcomes === 'function') {
      outcomes = opts.store.listOutcomes();
    }
  } catch (_err) {
    outcomes = []; // never let an outcome-read failure abort distillation
  }

  const drafted = [];
  for (const cluster of clusters) {
    if (cluster.count < (THRESHOLDS[cluster.kind] ?? 1)) continue;
    const base = draftFromCluster(cluster, { now, existing });
    if (rejected.has(base.id)) continue;
    drafted.push(applyOutcomeWeighting(base, outcomes));
  }

  const wrote = [];
  if (!opts.dryRun) {
    for (const instinct of drafted) {
      try {
        instinctStore.writeInstinct(instinct);
        wrote.push(instinct.id);
      } catch (_err) {
        // Skip a draft that fails schema validation; never throw out of distill.
      }
    }
  }

  return { drafted, wrote };
}

module.exports = {
  THRESHOLDS,
  BASE_CONFIDENCE,
  OUTCOME_DOMAIN,
  isDerivable,
  inferDomain,
  deriveSignals,
  clusterSignals,
  frequencyConfidence,
  instinctId,
  draftFromCluster,
  applyOutcomeWeighting,
  distill,
};
