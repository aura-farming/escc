'use strict';

/*
 * ESCC trigger-watch (NEW for ESCC) — the read-only signal sweep behind
 * `escc watch` (spec §6.6 / §A.6).
 *
 * Surfaces actionable TIMING signals ESCC already holds, and routes a digest
 * through notify.js:
 *   - deals closing within a horizon (account-memory.listNearCloseDeals);
 *   - OVERDUE open promises (state-store `promises`, A.2 C3).
 *
 * Strictly read-only: it opens the state store, reads, and closes — never writes.
 * Deeper buying/intent-signal detection (web/news/CRM-trigger classification) is
 * Phase 5 content: the trigger-detection skill + trigger-scout agent. The
 * ESCC_WATCH_INTERVAL cadence is honored by whatever scheduler invokes this, not
 * by a long-lived loop here.
 */

const accountMemory = require('./account-memory');
const { createStateStoreSync } = require('./state-store/index.js');
const { notify: defaultNotify } = require('./notify');

const DEFAULT_WITHIN_DAYS = 14;
const MAX_LISTED = 8;

function todayFrom(now) {
  return (now ? String(now) : new Date().toISOString()).slice(0, 10);
}

/** Read overdue open promises from the state store (read-only; fail-soft -> []). */
function overduePromises(today) {
  let store;
  try {
    store = createStateStoreSync();
    return store.listOpenPromises().filter(p => p.due_date && p.due_date < today);
  } catch (_err) {
    return [];
  } finally {
    if (store) {
      try { store.close(); } catch (_e) { /* soft */ }
    }
  }
}

/**
 * Read-only sweep for actionable timing signals.
 * @param {{now?:string, withinDays?:number, options?:object}} [args]
 * @returns {{now:string, nearCloseDeals:Array, overduePromises:Array, signalCount:number}}
 */
function sweep(args = {}) {
  const now = args.now || new Date().toISOString();
  const withinDays = Number.isFinite(args.withinDays) ? args.withinDays : DEFAULT_WITHIN_DAYS;
  const options = args.options || {};

  let nearCloseDeals = [];
  try {
    nearCloseDeals = accountMemory.listNearCloseDeals(withinDays, { now, ...options });
  } catch (_err) {
    nearCloseDeals = [];
  }
  const overdue = overduePromises(todayFrom(now));

  return {
    now,
    nearCloseDeals,
    overduePromises: overdue,
    signalCount: nearCloseDeals.length + overdue.length,
  };
}

/** Build the human/notification digest body from a sweep result. */
function buildMessage(digest) {
  const lines = [];
  if (digest.overduePromises.length) {
    lines.push(`${digest.overduePromises.length} OVERDUE promise(s):`);
    for (const p of digest.overduePromises.slice(0, MAX_LISTED)) {
      lines.push(`- ${p.text}${p.account_id ? ` [${p.account_id}]` : ''}${p.due_date ? ` (due ${p.due_date})` : ''}`);
    }
  }
  if (digest.nearCloseDeals.length) {
    lines.push(`${digest.nearCloseDeals.length} deal(s) closing soon:`);
    for (const d of digest.nearCloseDeals.slice(0, MAX_LISTED)) {
      lines.push(`- ${d.name || d.deal_id}${d.account_id ? ` [${d.account_id}]` : ''} — close ${d.close_date}`);
    }
  }
  return lines.join('\n');
}

/**
 * Run one sweep and route a digest through notify (ONLY when there are signals,
 * to avoid notification noise). Severity escalates to 'high' when something is
 * overdue. A delivery failure never crashes the sweep.
 * @param {{now?:string, withinDays?:number, notify?:Function, options?:object}} [args]
 * @returns {{code:number, text:string, data:{digest, delivered:boolean}}}
 */
function runWatch(args = {}) {
  const notify = typeof args.notify === 'function' ? args.notify : defaultNotify;
  const digest = sweep(args);

  if (digest.signalCount === 0) {
    return {
      code: 0,
      text: 'escc watch: no signals (no overdue promises, no deals closing soon).',
      data: { digest, delivered: false },
    };
  }

  const severity = digest.overduePromises.length ? 'high' : 'medium';
  let delivered = false;
  try {
    notify({ severity, title: `ESCC watch — ${digest.signalCount} signal(s)`, message: buildMessage(digest) });
    delivered = true;
  } catch (_err) {
    delivered = false;
  }

  const text = `escc watch: ${digest.signalCount} signal(s) — ${digest.overduePromises.length} overdue, ${digest.nearCloseDeals.length} closing soon${delivered ? ' (notified)' : ' (notify failed)'}.`;
  return { code: 0, text, data: { digest, delivered } };
}

module.exports = { sweep, runWatch, overduePromises, buildMessage, DEFAULT_WITHIN_DAYS };
