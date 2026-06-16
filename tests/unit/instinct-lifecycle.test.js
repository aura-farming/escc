'use strict';

/*
 * Tests for the A.3 instinct LIFECYCLE (Pass 3):
 *   - scripts/instincts/lifecycle.js — decay (I4), manager-gated promotion (I5),
 *     evolve threshold (I6), and the actionable review gate (I7).
 *
 * Guarantees proven here:
 *   I4  time-based decay reduces confidence; deals/outreach/crm decay faster than
 *       process/preferences; decay_exempt instincts never decay; a swept instinct
 *       below the retire floor is removed.
 *   I5  promotion personal->team NEVER happens automatically — it requires an
 *       explicit, manager-role-checked call.
 *   I6  a domain graduates to an evolved artifact only at >=3 instincts with avg
 *       confidence >=0.7.
 *   I7  reject removes an instinct and records its id so distill never resurrects
 *       it; approve clears it from the pending-review list.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../../scripts/instincts/instinct-store');
const lifecycle = require('../../scripts/instincts/lifecycle');
const distill = require('../../scripts/instincts/distill');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-lifecycle-'));
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
    decay_exempt: false,
    action: 'do the thing',
    evidence: ['seen once'],
    ...overrides,
  };
}

const NOW = '2026-06-29T00:00:00.000Z'; // exactly 4 weeks after 2026-06-01

// --- I4 decay ---------------------------------------------------------------

test('I4: decayInstinct reduces confidence by the per-week rate since last_observed', () => {
  const out = lifecycle.decayInstinct(instinct({ domain: 'process', confidence: 0.6 }), { now: NOW });
  assert.equal(out.confidence, 0.52, '0.6 - 4 weeks * 0.02 = 0.52');
});

test('I4: a decay_exempt instinct never decays', () => {
  const out = lifecycle.decayInstinct(instinct({ decay_exempt: true, confidence: 0.6 }), { now: NOW });
  assert.equal(out.confidence, 0.6, 'exempt instinct unchanged');
});

test('I4: deals/outreach/crm decay faster than process', () => {
  const proc = lifecycle.decayInstinct(instinct({ domain: 'process', confidence: 0.6 }), { now: NOW }).confidence;
  const outreach = lifecycle.decayInstinct(instinct({ domain: 'outreach', confidence: 0.6 }), { now: NOW }).confidence;
  assert.ok(outreach < proc, `outreach (${outreach}) should decay below process (${proc})`);
});

test('I4: confirmation raises and contradiction lowers confidence', () => {
  assert.equal(lifecycle.applyContradiction(instinct({ confidence: 0.5 })).confidence, 0.4);
  assert.equal(lifecycle.applyConfirmation(instinct({ confidence: 0.5 })).confidence, 0.55);
  assert.equal(lifecycle.applyConfirmation(instinct({ confidence: 0.88 })).confidence, 0.9, 'confirmation caps at 0.9');
});

test('I4: decaySweep writes decayed confidence and retires instincts below the floor', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l1' }, () => {
    store.writeInstinct(instinct({ id: 'keep', domain: 'process', confidence: 0.6 }));
    store.writeInstinct(instinct({ id: 'retire', domain: 'outreach', confidence: 0.25 }));
    const summary = lifecycle.decaySweep({ now: NOW });

    const ids = store.readInstincts('personal').map(i => i.id);
    assert.ok(ids.includes('keep'), 'healthy instinct survives');
    assert.ok(!ids.includes('retire'), 'instinct below floor is retired');
    assert.deepEqual(summary.retired, ['retire']);
    assert.equal(store.readInstincts('personal').find(i => i.id === 'keep').confidence, 0.52);
  });
});

test('I4: decaySweep is idempotent at a fixed instant — a repeated sweep does not compound', () => {
  // The decay sweep runs on EVERY SessionStart. If a sweep did not advance the
  // decay anchor, a rep who started five sessions in one week would apply five
  // weeks of decay and prematurely retire healthy instincts. A second sweep at
  // the same `now` must be a no-op.
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-idem-1' }, () => {
    store.writeInstinct(instinct({ id: 'keep', domain: 'process', confidence: 0.6 }));
    lifecycle.decaySweep({ now: NOW }); // +4 weeks -> 0.52
    lifecycle.decaySweep({ now: NOW }); // same instant -> must stay 0.52
    assert.equal(
      store.readInstincts('personal').find(i => i.id === 'keep').confidence,
      0.52,
      'a repeated sweep at the same now must not decay again',
    );
  });
});

test('I4: incremental sweeps do not compound — two part-sweeps equal one full sweep', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-idem-2' }, () => {
    // created/last_observed = 2026-06-01. Sweep at +2 weeks, then at +4 weeks.
    store.writeInstinct(instinct({ id: 'keep', domain: 'process', confidence: 0.6 }));
    lifecycle.decaySweep({ now: '2026-06-15T00:00:00.000Z' }); // +2 weeks -> 0.56
    lifecycle.decaySweep({ now: '2026-06-29T00:00:00.000Z' }); // +2 more weeks -> 0.52
    assert.equal(
      store.readInstincts('personal').find(i => i.id === 'keep').confidence,
      0.52,
      'two incremental sweeps equal a single 4-week sweep (0.6 - 4*0.02), not 0.48',
    );
  });
});

// --- I5 promotion -----------------------------------------------------------

test('I5: promotion is refused without a manager role (no automatic promotion)', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l2' }, () => {
    store.writeInstinct(instinct({ id: 'p1' }));
    const res = lifecycle.promoteInstinct('p1', { role: 'rep' });
    assert.equal(res.promoted, false);
    assert.ok(store.readInstincts('personal').some(i => i.id === 'p1'), 'stays personal');
    assert.equal(store.readInstincts('team').length, 0, 'nothing reaches team scope');
  });
});

test('I5: a manager can explicitly promote a personal instinct to team scope', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l3' }, () => {
    store.writeInstinct(instinct({ id: 'p2' }));
    const res = lifecycle.promoteInstinct('p2', { role: 'manager' });
    assert.equal(res.promoted, true);
    const team = store.readInstincts('team');
    assert.equal(team.length, 1);
    assert.equal(team[0].id, 'p2');
    assert.equal(team[0].scope, 'team', 'scope flipped to team');
    assert.ok(!store.readInstincts('personal').some(i => i.id === 'p2'), 'moved out of personal');
  });
});

// --- I6 evolve --------------------------------------------------------------

test('I6: a domain graduates only at >=3 instincts with avg confidence >=0.7', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l4' }, () => {
    store.writeInstinct(instinct({ id: 'd1', domain: 'deals', confidence: 0.8 }));
    store.writeInstinct(instinct({ id: 'd2', domain: 'deals', confidence: 0.75 }));
    const none = lifecycle.findEvolutionCandidates();
    assert.equal(none.length, 0, 'two instincts: below count threshold');

    store.writeInstinct(instinct({ id: 'd3', domain: 'deals', confidence: 0.7 }));
    const candidates = lifecycle.findEvolutionCandidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].domain, 'deals');
    assert.equal(candidates[0].instincts.length, 3);
  });
});

test('I6: a high-count but low-confidence domain does not graduate', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l5' }, () => {
    store.writeInstinct(instinct({ id: 'c1', domain: 'crm', confidence: 0.5 }));
    store.writeInstinct(instinct({ id: 'c2', domain: 'crm', confidence: 0.55 }));
    store.writeInstinct(instinct({ id: 'c3', domain: 'crm', confidence: 0.6 }));
    assert.equal(lifecycle.findEvolutionCandidates().length, 0, 'avg confidence < 0.7');
  });
});

test('I6: evolve writes an evolved skill draft with evolved provenance', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l6' }, () => {
    store.writeInstinct(instinct({ id: 'd1', domain: 'deals', confidence: 0.8 }));
    store.writeInstinct(instinct({ id: 'd2', domain: 'deals', confidence: 0.75 }));
    store.writeInstinct(instinct({ id: 'd3', domain: 'deals', confidence: 0.7 }));
    const res = lifecycle.evolve({ now: NOW });
    assert.equal(res.wrote.length, 1);
    const body = fs.readFileSync(res.wrote[0], 'utf8');
    assert.ok(/provenance:\s*evolved/.test(body), 'artifact is marked evolved');
    assert.ok(/deals/.test(body), 'artifact references the domain');
  });
});

// --- I7 review gate ---------------------------------------------------------

test('I7: rejecting an instinct removes it and prevents distill from resurrecting it', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l7' }, () => {
    store.appendObservation({ kind: 'user_correction', text: 'always send a recap after every demo', untrusted: false });
    distill.distill({ now: NOW });
    const id = store.readInstincts('personal')[0].id;

    lifecycle.rejectInstinct(id);
    assert.ok(!store.readInstincts('personal').some(i => i.id === id), 'rejected instinct removed');
    assert.ok(store.readIdRegistry('rejected').includes(id), 'id recorded in the rejected registry');

    distill.distill({ now: NOW });
    assert.ok(!store.readInstincts('personal').some(i => i.id === id), 'distill does not resurrect a rejected id');
  });
});

test('I7: approve clears an instinct from the pending-review list', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-l8' }, () => {
    store.writeInstinct(instinct({ id: 'r1' }));
    store.writeInstinct(instinct({ id: 'r2' }));
    assert.equal(lifecycle.listForReview().length, 2, 'both pending initially');
    lifecycle.approveInstinct('r1');
    const pending = lifecycle.listForReview().map(i => i.id);
    assert.deepEqual(pending, ['r2'], 'approved instinct no longer pending');
  });
});
