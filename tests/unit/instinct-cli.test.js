'use strict';

/*
 * Tests for the A.3 instinct CLI (Pass 4):
 *   - scripts/instincts/instinct-cli.js — the logic behind /instinct-status (I7
 *     review affordance), /instinct-promote (I5), and /evolve (I6). Thin command
 *     shims (Phase 5) call these handlers; escc.js can later mount them too.
 *
 * Hermetic: ESCC_INSTINCT_HOME + ESCC_REP_IDENTITY point the store at a tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../../scripts/instincts/instinct-store');
const cli = require('../../scripts/instincts/instinct-cli');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-cli-'));
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

function instinct(overrides = {}) {
  return {
    id: 'i1',
    trigger: 'when doing sales work',
    confidence: 0.6,
    domain: 'process',
    scope: 'personal',
    source: 'user_correction',
    created: '2026-06-01T00:00:00.000Z',
    last_observed: '2026-06-01T00:00:00.000Z',
    action: 'do the thing',
    evidence: ['seen'],
    ...overrides,
  };
}

test('status lists personal + team instincts and flags pending ones', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-c1' }, () => {
    store.writeInstinct(instinct({ id: 'a', confidence: 0.7 }));
    store.writeInstinct(instinct({ id: 'b', scope: 'team', confidence: 0.8 }));
    const res = cli.status();
    assert.equal(res.code, 0);
    assert.equal(res.data.personal.length, 1);
    assert.equal(res.data.team.length, 1);
    assert.deepEqual(res.data.pending.sort(), ['a'], 'team instincts are not pending personal review');
    assert.ok(/a/.test(res.text) && /b/.test(res.text), 'report names both instincts');
    assert.ok(/PENDING/.test(res.text), 'pending marker shown');
  });
});

test('status --reject removes the instinct and records it', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-c2' }, () => {
    store.writeInstinct(instinct({ id: 'x' }));
    const res = cli.status({ reject: 'x' });
    assert.equal(res.code, 0);
    assert.ok(!store.readInstincts('personal').some(i => i.id === 'x'), 'rejected instinct removed');
    assert.ok(store.readIdRegistry('rejected').includes('x'));
  });
});

test('status --approve clears the pending marker', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-c3' }, () => {
    store.writeInstinct(instinct({ id: 'y' }));
    cli.status({ approve: 'y' });
    const res = cli.status();
    assert.equal(res.data.pending.length, 0, 'approved instinct no longer pending');
  });
});

test('promote is refused for a non-manager role', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-c4', ESCC_ROLE: 'rep' }, () => {
    store.writeInstinct(instinct({ id: 'p' }));
    const res = cli.promote('p');
    assert.equal(res.code, 1, 'non-zero exit signals refusal');
    assert.ok(/manager/i.test(res.text), 'explains the role requirement');
    assert.ok(store.readInstincts('personal').some(i => i.id === 'p'));
  });
});

test('promote succeeds for a manager role', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-c5', ESCC_ROLE: 'manager' }, () => {
    store.writeInstinct(instinct({ id: 'q' }));
    const res = cli.promote('q');
    assert.equal(res.code, 0);
    assert.equal(store.readInstincts('team').length, 1);
  });
});

test('evolve reports the drafted artifacts', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-c6' }, () => {
    store.writeInstinct(instinct({ id: 'd1', domain: 'deals', confidence: 0.8 }));
    store.writeInstinct(instinct({ id: 'd2', domain: 'deals', confidence: 0.75 }));
    store.writeInstinct(instinct({ id: 'd3', domain: 'deals', confidence: 0.7 }));
    const res = cli.evolve({ now: '2026-06-15T00:00:00.000Z' });
    assert.equal(res.code, 0);
    assert.equal(res.data.wrote.length, 1);
    assert.ok(/deals/.test(res.text));
  });
});

test('run dispatches by command and rejects an unknown one', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-c7' }, () => {
    store.writeInstinct(instinct({ id: 'z' }));
    assert.equal(cli.run(['status']).code, 0);
    assert.equal(cli.run(['definitely-not-a-command']).code, 1);
  });
});
