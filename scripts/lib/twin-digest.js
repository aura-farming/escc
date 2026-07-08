'use strict';

/*
 * ESCC twin digest (NEW for ESCC; v1.9.0, ADR-0019 WS-D.7).
 *
 * A read-only "what did the digital twin learn / stage this week" summary. The
 * twin writes across several stores (outcomes, prepared-day items, knowledge
 * candidates, pending instincts); /instinct-status and `escc audit` each cover
 * only one. This folds new-since-N-days counts into ONE surface and, for each
 * line, points at the surface where the rep can correct or roll it back — so
 * the rep can SEE and steer what the twin learned. It never mutates anything
 * and never becomes another approval queue (counts + pointers only). Fail-soft:
 * a broken source contributes 0, never an error.
 */

const { createStateStoreSync } = require('./state-store');
const worklistStore = require('./worklist-store');

function windowDays() {
  const n = Number(process.env.ESCC_TWIN_WINDOW_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
}

/**
 * @param {{days?:number, now?:string|number}} [options]
 * @returns {{days, outcomes, outcomesTotal, preparedOpen, candidatesPending, instinctsPending}}
 */
function buildTwinDigest(options = {}) {
  const days = Number.isFinite(options.days) && options.days > 0 ? Math.floor(options.days) : windowDays();
  const nowMs = options.now != null ? Date.parse(String(options.now)) : Date.now();
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  const within = (iso) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t >= cutoffMs;
  };

  const digest = { days, outcomes: {}, outcomesTotal: 0, preparedOpen: 0, candidatesPending: 0, instinctsPending: 0 };

  try {
    const db = createStateStoreSync();
    try {
      for (const o of db.listOutcomes()) {
        if (within(o.created_at)) {
          digest.outcomes[o.type] = (digest.outcomes[o.type] || 0) + 1;
          digest.outcomesTotal += 1;
        }
      }
    } finally {
      db.close();
    }
  } catch (_err) { /* fail-soft */ }

  try {
    digest.preparedOpen = worklistStore.listPreparedItems({ status: 'open' }).length;
  } catch (_err) { /* fail-soft */ }

  try {
    digest.candidatesPending = require('./product-knowledge').readCandidates().length;
  } catch (_err) { /* fail-soft */ }

  try {
    const lifecycle = require('../instincts/lifecycle');
    digest.instinctsPending = ['personal', 'team'].reduce((n, scope) => {
      try {
        return n + lifecycle.listForReview({ scope }).length;
      } catch (_err) {
        return n;
      }
    }, 0);
  } catch (_err) { /* fail-soft */ }

  return digest;
}

function formatTwinDigest(d) {
  const otypes = Object.keys(d.outcomes).sort();
  const lines = [
    `ESCC twin — what changed in the last ${d.days} day(s):`,
    `  outcomes recorded: ${d.outcomesTotal}${otypes.length ? ` (${otypes.map(t => `${t} ${d.outcomes[t]}`).join(', ')})` : ''}  -> escc outcome list; roll back a bad one with 'escc outcome void <id>'`,
    `  prepared-day items open: ${d.preparedOpen}  -> /daily`,
    `  knowledge candidates awaiting review: ${d.candidatesPending}  -> escc product candidates`,
    `  instincts pending review: ${d.instinctsPending}  -> /instinct-status`,
    'Everything above sits behind a human gate — nothing the twin learned is quotable, sendable, or active until you approve it.',
  ];
  return lines.join('\n');
}

/** CLI wrapper for `escc twin`. @returns {{code,text,data}} */
function runTwin(flags = {}) {
  const digest = buildTwinDigest({ days: flags.days ? Number(flags.days) : undefined });
  return { code: 0, text: formatTwinDigest(digest), data: digest };
}

module.exports = { buildTwinDigest, formatTwinDigest, runTwin };
