'use strict';

/*
 * Tests for scripts/lib/account-reconcile (ADR-0018) — "HubSpot wins" as code
 * — plus the T1d staleness quick win in renderDigest. Hermetic temp homes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const reconcileLib = require('../../scripts/lib/account-reconcile');
const mem = require('../../scripts/lib/account-memory');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-reconcile-'));
}

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

function seedAcme() {
  mem.appendEvent('company:12345', { type: 'deal', deal_id: 'd1', stage: 'negotiation', amount: 100000, close_date: '2026-08-01', ts: '2026-06-01T00:00:00Z' });
  mem.appendEvent('company:12345', { id: 'L1', type: 'loop', deal_id: 'd1', text: 'Send MSA redlines', status: 'open', ts: '2026-06-02T00:00:00Z' });
  mem.appendEvent('company:12345', { id: 'L2', type: 'promise', text: 'Intro to the CFO', status: 'open', ts: '2026-06-03T00:00:00Z' });
}

const SNAPSHOT = {
  asOf: '2026-07-07T00:00:00Z',
  deals: [
    { deal_id: 'd1', stage: 'closed won', amount: 120000, close_date: '2026-07-01', status: 'won' },
    { deal_id: 'd2', stage: 'discovery', amount: 30000 },
  ],
};

test('report mode surfaces drift, seeds, and loop closures WITHOUT writing', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    seedAcme();
    const before = mem.readEvents('company:12345').length;

    const r = reconcileLib.reconcile('company:12345', SNAPSHOT, { apply: false });
    assert.equal(r.applied, false);
    assert.ok(r.drift.some(d => d.deal_id === 'd1' && d.field === 'stage' && d.crm === 'closed won'), 'stage drift detected');
    assert.ok(r.drift.some(d => d.field === 'amount' && d.memory === 100000 && d.crm === 120000), 'amount drift detected');
    assert.deepEqual(r.missingInMemory, ['d2'], 'CRM-only deal will seed');
    assert.ok(r.loopsClosed.some(l => l.id === 'L1'), 'deal-status loop flagged for closure');
    assert.equal(mem.readEvents('company:12345').length, before, 'report mode wrote NOTHING');

    const report = reconcileLib.formatReport(r);
    assert.match(report, /DRIFT REPORT/);
    assert.match(report, /--apply/);
  });
});

test('--apply syncs memory to CRM, closes ONLY deal-status loops, with provenance', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    seedAcme();
    const r = reconcileLib.reconcile('company:12345', SNAPSHOT, { apply: true, now: '2026-07-07T01:00:00Z' });
    assert.equal(r.applied, true);
    assert.ok(r.eventsAppended >= 3, 'drift + seed + loop-close events appended');

    const h = mem.hydrate('company:12345');
    assert.equal(h.deals.d1.stage, 'closed won', 'memory now matches CRM');
    assert.equal(h.deals.d1.amount, 120000);
    assert.ok(h.deals.d2, 'CRM-only deal seeded into memory');
    assert.ok(!h.openLoops.some(l => l.id === 'L1'), 'deal-status loop auto-closed');
    assert.ok(h.openLoops.some(l => l.id === 'L2'), 'human promise loop UNTOUCHED');

    const events = mem.readEvents('company:12345');
    assert.ok(events.some(e => e.source === 'crm-reconcile'), 'reconcile events carry provenance');

    // Idempotent: a second apply of the same snapshot finds no drift.
    const r2 = reconcileLib.reconcile('company:12345', SNAPSHOT, { apply: true });
    assert.equal(r2.drift.length, 0);
    assert.equal(r2.eventsAppended, 0, 'nothing re-appended when memory matches');
  });
});

test('memory-only deals are reported for review, never auto-closed', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    mem.appendEvent('globex.example', { type: 'deal', deal_id: 'dx', stage: 'proposal', ts: '2026-06-01T00:00:00Z' });
    const r = reconcileLib.reconcile('globex.example', { deals: [] }, { apply: true });
    assert.deepEqual(r.unknownInCrm, ['dx']);
    assert.equal(mem.hydrate('globex.example').deals.dx.stage, 'proposal', 'memory-only deal untouched');
    assert.match(reconcileLib.formatReport(r), /REVIEW MANUALLY/);
  });
});

test('reconcile resolves the account canonically (alias input joins the same store)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const identity = require('../../scripts/lib/account-identity');
    identity.linkAlias('Example Co Pty Ltd', 'company:12345');
    seedAcme();
    const r = reconcileLib.reconcile('Example Co Pty Ltd', SNAPSHOT, { apply: false });
    assert.equal(r.canonical, 'company_12345');
    assert.ok(r.drift.length > 0, 'joined the canonical store through the alias');
  });
});

// --- T1d: staleness in the digest ------------------------------------------------

test('renderDigest separates stale open loops (never drops them)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_LOOP_STALE_DAYS: undefined }, () => {
    mem.appendEvent('acme', { id: 'old', type: 'loop', text: 'Ancient promise', status: 'open', ts: '2026-01-01T00:00:00Z' });
    mem.appendEvent('acme', { id: 'new', type: 'loop', text: 'Fresh promise', status: 'open', ts: '2026-07-01T00:00:00Z' });
    const digest = mem.renderDigest(mem.hydrate('acme'), 4000, { now: '2026-07-07T00:00:00Z' });
    assert.match(digest, /Stale open loops \(>21d old — reverify before acting\):/);
    assert.ok(digest.indexOf('Fresh promise') < digest.indexOf('Ancient promise'), 'live loops listed first');
    assert.match(digest, /Ancient promise/, 'stale loop still present — never dropped');
  });
});

test('ESCC_LOOP_STALE_DAYS tunes the window; missing ts never counts as stale', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_LOOP_STALE_DAYS: '3' }, () => {
    mem.appendEvent('acme', { id: 'a', type: 'loop', text: 'Five days old', status: 'open', ts: '2026-07-02T00:00:00Z' });
    const digest = mem.renderDigest(mem.hydrate('acme'), 4000, { now: '2026-07-07T00:00:00Z' });
    assert.match(digest, />3d old/, 'custom window honored');
    assert.match(digest, /Five days old/);
  });
});

test('escc reconcile CLI: report by default, --apply syncs', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const cli = require('../../scripts/escc.js');
    seedAcme();
    const input = path.join(home, 'snap.json');
    fs.writeFileSync(input, JSON.stringify(SNAPSHOT));

    assert.equal(cli.run(['reconcile']).code, 1, 'missing snapshot/account refused');
    const report = cli.run(['reconcile', 'company:12345', '--input', input]);
    assert.equal(report.code, 0);
    assert.match(report.text, /DRIFT REPORT/);
    const applied = cli.run(['reconcile', 'company:12345', '--input', input, '--apply']);
    assert.equal(applied.code, 0);
    assert.match(applied.text, /RECONCILED/);
    assert.equal(mem.hydrate('company:12345').deals.d1.stage, 'closed won');
  });
});
