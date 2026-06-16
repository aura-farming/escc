'use strict';

/*
 * Tests for scripts/instincts/instinct-store — the workspace-keyed instinct +
 * observation store (A.3 I1 rep-identity keying; storage under
 * ${XDG_DATA_HOME}/escc/workspaces/<hash>/). Hermetic: ESCC_INSTINCT_HOME points
 * the store root at a fresh tmpdir; ESCC_REP_IDENTITY sets the workspace key.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../../scripts/instincts/instinct-store');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-instinct-'));
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

test('workspace is keyed by rep identity, not git remote (I1)', () => {
  const home = freshHome();
  const dirA = withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-a@acme.com' }, () => store.resolveWorkspaceDir());
  const dirB = withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-b@acme.com' }, () => store.resolveWorkspaceDir());
  assert.notEqual(dirA, dirB, 'different reps get different workspaces');
  assert.ok(dirA.startsWith(home), 'workspace lives under the configured root');
});

test('resolveRepIdentity falls back to default when unset', () => {
  withEnv({ ESCC_REP_IDENTITY: undefined, ESCC_HUBSPOT_OWNER: undefined, ESCC_SENDER_EMAIL: undefined }, () => {
    assert.equal(store.resolveRepIdentity(), 'default');
  });
});

test('appendObservation -> readObservations round-trips and fills id/ts', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-a' }, () => {
    const obs = store.appendObservation({ kind: 'user_correction', text: 'prefer shorter subject lines' });
    assert.ok(obs.id, 'observation id filled');
    assert.ok(obs.ts, 'observation ts filled');
    const all = store.readObservations();
    assert.equal(all.length, 1);
    assert.equal(all[0].text, 'prefer shorter subject lines');
  });
});

test('writeInstinct -> readInstincts round-trips fields, confidence as number', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-a' }, () => {
    store.writeInstinct({
      id: 'short-subjects',
      trigger: 'composing a cold email subject line',
      confidence: 0.8,
      domain: 'outreach',
      scope: 'personal',
      applies_to: 'enterprise,mid-market',
      source: 'user_correction',
      created: '2026-06-15T00:00:00.000Z',
      action: 'Keep subject lines under 6 words.',
      evidence: ['rep shortened two subjects', 'higher open rate noted'],
    });
    const list = store.readInstincts('personal');
    assert.equal(list.length, 1);
    const i = list[0];
    assert.equal(i.id, 'short-subjects');
    assert.strictEqual(i.confidence, 0.8, 'confidence parsed back as a number');
    assert.equal(i.domain, 'outreach');
    assert.equal(i.applies_to, 'enterprise,mid-market');
    assert.ok(/under 6 words/i.test(i.action), 'action preserved');
    assert.deepEqual(i.evidence, ['rep shortened two subjects', 'higher open rate noted'], 'evidence preserved');
  });
});

test('validateInstinct rejects out-of-enum domain and out-of-range confidence', () => {
  const base = { id: 'x', trigger: 't', confidence: 0.5, domain: 'process', scope: 'personal', created: '2026-06-15' };
  assert.ok(store.validateInstinct(base).valid, 'valid instinct passes');
  assert.ok(!store.validateInstinct({ ...base, domain: 'engineering' }).valid, 'bad domain rejected');
  assert.ok(!store.validateInstinct({ ...base, confidence: 1.5 }).valid, 'out-of-range confidence rejected');
});

test('writeInstinct throws on an invalid instinct (fail loud at the write boundary)', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-a' }, () => {
    assert.throws(() => store.writeInstinct({ id: 'bad', trigger: 't', confidence: 9, domain: 'process', scope: 'personal', created: '2026-06-15' }));
  });
});
