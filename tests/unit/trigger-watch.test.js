'use strict';

/*
 * Tests for scripts/lib/trigger-watch.js — the read-only signal sweep behind
 * `escc watch` (spec §A.6). It surfaces actionable timing signals that ESCC
 * already holds — deals closing within a horizon + OVERDUE promises — and routes
 * a digest through notify.js. (Deep buying/intent-signal detection is Phase 5:
 * the trigger-detection skill + trigger-scout agent.)
 *
 * Proven here: the sweep is read-only and horizon-bounded; runWatch notifies only
 * when there are signals, escalating severity when something is overdue.
 *
 * Hermetic: ESCC_AGENT_DATA_HOME homes both account-memory and the state store.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const accountMemory = require('../../scripts/lib/account-memory');
const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');
const watch = require('../../scripts/lib/trigger-watch');

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function freshEnv() {
  return { ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-watch-')) };
}

const NOW = '2026-06-16T12:00:00.000Z';

function seedSignals() {
  // A deal closing inside the 14-day horizon, and one far outside it.
  accountMemory.appendEvent('acme', { type: 'note', deal_id: 'd1', name: 'Acme', stage: 'negotiation', close_date: '2026-06-20', status: 'open' });
  accountMemory.appendEvent('zeta', { type: 'note', deal_id: 'd9', name: 'Zeta', stage: 'discovery', close_date: '2026-12-01', status: 'open' });

  // An overdue open promise, and an open-but-not-yet-due one.
  const store = createStateStoreSync();
  try {
    store.upsertPromise({ id: 'p1', text: 'send pricing', due_date: '2026-06-01', account_id: 'acme', status: 'open' });
    store.upsertPromise({ id: 'p2', text: 'check in', due_date: '2026-07-01', account_id: 'beta', status: 'open' });
  } finally {
    store.close();
  }
}

test('sweep returns horizon-bounded near-close deals and overdue promises only', () => {
  withEnv(freshEnv(), () => {
    seedSignals();
    const digest = watch.sweep({ now: NOW, withinDays: 14 });

    assert.deepEqual(digest.nearCloseDeals.map(d => d.deal_id).sort(), ['d1'], 'far-future deal excluded by horizon');
    assert.deepEqual(digest.overduePromises.map(p => p.id).sort(), ['p1'], 'only the overdue promise counts (p2 not yet due)');
    assert.equal(digest.signalCount, 2);
  });
});

test('runWatch notifies once with escalated severity when an overdue signal exists', () => {
  withEnv(freshEnv(), () => {
    seedSignals();
    const calls = [];
    const res = watch.runWatch({ now: NOW, withinDays: 14, notify: (o) => { calls.push(o); return { status: 'queued' }; } });

    assert.equal(res.code, 0);
    assert.equal(res.data.delivered, true);
    assert.equal(calls.length, 1, 'exactly one digest notification');
    assert.equal(calls[0].severity, 'high', 'overdue promise escalates severity');
    assert.ok(/acme/i.test(calls[0].message), 'digest names the at-risk account');
  });
});

test('runWatch stays silent when there are no signals (no noise)', () => {
  withEnv(freshEnv(), () => {
    const calls = [];
    const res = watch.runWatch({ now: NOW, withinDays: 14, notify: (o) => { calls.push(o); } });

    assert.equal(res.code, 0);
    assert.equal(res.data.delivered, false, 'nothing delivered');
    assert.equal(calls.length, 0, 'no notification fired on an empty sweep');
    assert.ok(/no signals/i.test(res.text), 'reports an empty sweep');
  });
});
