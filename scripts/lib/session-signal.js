/*
 * ESCC session-signal (NEW for ESCC; v1.8.0 learning loop quick win).
 *
 * session-outcomes.jsonl (written by the stop:evaluate-session hook) was an
 * ORPHAN: one writer, zero readers. This module folds those per-session sales
 * metrics into the one signal they reliably carry — the FOLLOW-THROUGH GAP
 * (follow-ups promised in conversation vs follow-ups actually logged) — and
 * corroborates it against the real promise ledger before saying anything.
 *
 * Consumed by `escc outcome summary` and cited by coaching-prep as a coaching
 * INPUT (never surveillance, and never auto-minted into instincts — a gap
 * statistic is not a rep correction, and fabricating one would poison the
 * learning loop).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveAgentDataHome } = require('./agent-data-home');

// Mirrors scripts/hooks/evaluate-session.js (the single writer).
const OUTCOMES_FILE = path.join('escc', 'observations', 'session-outcomes.jsonl');
const DEFAULT_WINDOW_DAYS = 14;

function sessionOutcomesPath(options = {}) {
  return path.join(resolveAgentDataHome(options), OUTCOMES_FILE);
}

function readRows(options = {}) {
  let contents;
  try {
    contents = fs.readFileSync(sessionOutcomesPath(options), 'utf8');
  } catch (_err) {
    return [];
  }
  const rows = [];
  for (const line of contents.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch (_err) {
      /* skip torn line */
    }
  }
  return rows;
}

/**
 * Fold recent session metrics into a follow-through summary, corroborated
 * against the live promise ledger (transcript regex alone over-counts).
 * @param {{windowDays?:number, now?:string|number, store?:object}} [options]
 * @returns {{sessions, promised, logged, gap, gapRatio, openPromises, corroborated}}
 */
function followThroughSummary(options = {}) {
  const windowDays = Number.isInteger(options.windowDays) ? options.windowDays : DEFAULT_WINDOW_DAYS;
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;

  let sessions = 0;
  let promised = 0;
  let logged = 0;
  for (const row of readRows(options)) {
    const t = Date.parse(row.created_at || '');
    if (Number.isNaN(t) || t < cutoff) continue;
    const m = row.metrics || {};
    sessions += 1;
    promised += Number(m.followUpsPromised) || 0;
    logged += Number(m.followUpsCreated) || 0;
  }

  // Corroboration: the transcript heuristic only matters if the REAL ledger
  // agrees something is slipping (open promises actually outstanding).
  let openPromises = null;
  try {
    const store = options.store || require('./state-store').createStateStoreSync();
    try {
      openPromises = store.listOpenPromises().length;
    } finally {
      if (!options.store) store.close();
    }
  } catch (_err) {
    openPromises = null;
  }

  const gap = Math.max(0, promised - logged);
  const gapRatio = promised > 0 ? Math.round((gap / promised) * 100) / 100 : 0;
  return {
    windowDays,
    sessions,
    promised,
    logged,
    gap,
    gapRatio,
    openPromises,
    corroborated: gap > 0 && openPromises !== null && openPromises > 0,
  };
}

/** One coaching line, or '' when there is nothing worth saying. */
function formatFollowThrough(s) {
  if (!s || s.sessions === 0) return '';
  if (s.gap === 0) {
    return `Follow-through (${s.windowDays}d, ${s.sessions} session(s)): ${s.promised} promised, ${s.logged} logged — clean.`;
  }
  const corr = s.corroborated
    ? ` Corroborated: ${s.openPromises} promise(s) still open in the ledger.`
    : ' (Not corroborated by the promise ledger — treat as a transcript heuristic.)';
  return `Follow-through gap (${s.windowDays}d, ${s.sessions} session(s)): ${s.promised} follow-up(s) promised vs ${s.logged} logged — ${s.gap} unclosed (${Math.round(s.gapRatio * 100)}%).${corr} Coaching input, not surveillance.`;
}

module.exports = { sessionOutcomesPath, followThroughSummary, formatFollowThrough };
