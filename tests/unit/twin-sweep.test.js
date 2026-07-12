'use strict';

/*
 * Tests for the morning-sweep primitives (v1.9.0, ADR-0019):
 *   - accountMemory.listAccounts — enumerate accounts, newest first, with an
 *     optional active-within-days window (the accounts the sweep reconciles);
 *   - accountReconcile.reconcileBatch — one pass over a multi-account snapshot,
 *     per-entry failures captured, never fatal.
 * Hermetic: ESCC_AGENT_DATA_HOME points at a tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const accountMemory = require('../../scripts/lib/account-memory');
const accountReconcile = require('../../scripts/lib/account-reconcile');

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(overrides)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function freshHome() {
  return { ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-sweep-')) };
}

test('listAccounts enumerates every account, newest activity first', () => {
  withEnv(freshHome(), () => {
    accountMemory.appendEvent('company:1', { type: 'note', text: 'old', ts: '2026-06-01T00:00:00Z' });
    accountMemory.appendEvent('company:2', { type: 'note', text: 'new', ts: '2026-07-07T00:00:00Z' });
    const accts = accountMemory.listAccounts();
    assert.deepEqual(accts.map(a => a.account_id), ['company_2', 'company_1'], 'sorted newest-first');
    assert.equal(accts[0].last_event_at, '2026-07-07T00:00:00Z');
  });
});

test('listAccounts with an active window excludes stale accounts', () => {
  withEnv(freshHome(), () => {
    accountMemory.appendEvent('company:1', { type: 'note', text: 'stale', ts: '2026-05-01T00:00:00Z' });
    accountMemory.appendEvent('company:2', { type: 'note', text: 'fresh', ts: '2026-07-07T00:00:00Z' });
    const active = accountMemory.listAccounts({ activeWithinDays: 14, now: '2026-07-08T00:00:00Z' });
    assert.deepEqual(active.map(a => a.account_id), ['company_2'], 'only the account active in the last 14 days');
  });
});

test('reconcileBatch reconciles multiple accounts in one pass', () => {
  withEnv(freshHome(), () => {
    // seed a deal in memory for company:1 with a stale stage.
    accountMemory.appendEvent('company:1', { type: 'deal', deal_id: 'd1', stage: 'discovery', status: 'open' });

    const snapshot = {
      asOf: '2026-07-08T00:00:00Z',
      accounts: [
        { account: 'company:1', deals: [{ deal_id: 'd1', stage: 'negotiation', status: 'open' }] },
        { account: 'company:2', deals: [{ deal_id: 'd2', stage: 'discovery', status: 'open' }] },
      ],
    };
    const batch = accountReconcile.reconcileBatch(snapshot, { apply: true });
    assert.equal(batch.results.length, 2, 'both accounts reconciled');
    assert.equal(batch.errors.length, 0, 'no errors');

    // company:1 stage drift detected + applied; company:2 seeded.
    const r1 = batch.results.find(r => r.canonical === 'company_1');
    assert.ok(r1.drift.some(d => d.field === 'stage' && d.crm === 'negotiation'), 'stage drift found');
    const h1 = accountMemory.hydrate('company:1');
    assert.equal(h1.deals.d1.stage, 'negotiation', 'memory now matches CRM after apply');
  });
});

test('reconcileBatch captures a per-entry error without sinking the batch', () => {
  withEnv(freshHome(), () => {
    const snapshot = {
      accounts: [
        { account: '', deals: [] }, // unusable id -> captured error
        { account: 'company:2', deals: [{ deal_id: 'd2', stage: 'discovery' }] },
      ],
    };
    const batch = accountReconcile.reconcileBatch(snapshot, { apply: false });
    assert.equal(batch.errors.length, 1, 'the bad entry is captured');
    assert.equal(batch.results.length, 1, 'the good entry still reconciles');
  });
});
