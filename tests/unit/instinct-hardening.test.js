'use strict';

/*
 * Regression tests for the A.3 adversarial-review findings (engine-internal):
 *   #11 path-traversal guard on instinct ids (security)
 *   #5  decaySweep tolerates one instinct failing to re-validate (fail-open)
 *   #3  evolve continues past a write failure (fail-open)
 *   #4  appendObservation fills a falsy/absent id but respects an explicit one
 *   #10 applyOutcomeWeighting always returns a NEW object (immutability)
 *   #9/#12 serialize/parse round-trips action + evidence with markdown structure
 *   #6  parseInstinct tolerates a non-string input
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../../scripts/instincts/instinct-store');
const lifecycle = require('../../scripts/instincts/lifecycle');
const distill = require('../../scripts/instincts/distill');
const cli = require('../../scripts/instincts/instinct-cli');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-harden-'));
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

const NOW = '2026-06-29T00:00:00.000Z';

test('#11 security: a path-traversal instinct id is rejected by the store', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'harden-1' }, () => {
    assert.throws(() => store.instinctPath('../evil'), /unsafe/i);
    assert.throws(() => store.instinctPath('a/b'), /unsafe/i);
    assert.throws(() => store.writeInstinct(instinct({ id: '../../evil' })));
    assert.throws(() => store.removeInstinct('../../../etc/passwd'));
    // a safe slug still works
    assert.doesNotThrow(() => store.writeInstinct(instinct({ id: 'safe-id' })));
  });
});

test('#11 security: CLI --reject of a traversal id is refused, not executed', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'harden-2' }, () => {
    const res = cli.status({ reject: '../../evil' });
    assert.equal(res.code, 1, 'refused with a non-zero code');
    assert.ok(!store.readIdRegistry('rejected').includes('../../evil'), 'nothing recorded');
  });
});

test('#5 fail-open: decaySweep does not abort when one instinct fails to re-validate', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'harden-3' }, () => {
    store.writeInstinct(instinct({ id: 'good', domain: 'process', confidence: 0.6 }));
    // Hand-write a malformed instinct (invalid domain) that fails re-validation on write.
    const dir = store.instinctsDir('personal');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'bad.md'),
      '---\nid: bad\ntrigger: t\nconfidence: 0.6\ndomain: bogus\nscope: personal\ncreated: 2026-06-01T00:00:00.000Z\nlast_observed: 2026-06-01T00:00:00.000Z\n---\n\n## Action\nx\n',
    );
    let summary;
    assert.doesNotThrow(() => { summary = lifecycle.decaySweep({ now: NOW }); });
    assert.ok(summary.updated.includes('good'), 'the healthy instinct still decays');
    assert.ok(summary.failed.includes('bad'), 'the failing instinct is recorded, not thrown');
    assert.equal(store.readInstincts('personal').find(i => i.id === 'good').confidence, 0.52);
  });
});

test('#3 fail-open: evolve continues past a single write failure', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'harden-4' }, () => {
    store.writeInstinct(instinct({ id: 'd1', domain: 'deals', confidence: 0.8 }));
    store.writeInstinct(instinct({ id: 'd2', domain: 'deals', confidence: 0.75 }));
    store.writeInstinct(instinct({ id: 'd3', domain: 'deals', confidence: 0.7 }));
    // Block the target path with a directory so writeFileSync throws EISDIR.
    const dir = store.evolvedDir('skills');
    fs.mkdirSync(path.join(dir, 'deals-evolved-playbook.md'), { recursive: true });
    let res;
    assert.doesNotThrow(() => { res = lifecycle.evolve({ now: NOW }); });
    assert.ok(res.failed.length >= 1, 'the failed candidate is recorded');
    assert.equal(res.wrote.length, 0, 'nothing falsely reported as written');
  });
});

test('#4 appendObservation fills an absent or falsy id but respects an explicit one', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'harden-5' }, () => {
    assert.equal(store.appendObservation({ kind: 'x', id: 'fixed' }).id, 'fixed');
    assert.ok(store.appendObservation({ kind: 'y', id: '' }).id, 'empty id is replaced, never stored blank');
    assert.ok(store.appendObservation({ kind: 'z' }).id, 'absent id is filled');
  });
});

test('#10 immutability: applyOutcomeWeighting returns a new object even when unchanged', () => {
  const base = { id: 'i', confidence: 0.5, domain: 'process' };
  const noOutcomes = distill.applyOutcomeWeighting(base, []);
  assert.notStrictEqual(noOutcomes, base, 'no-outcome path returns a copy');
  const noMatch = distill.applyOutcomeWeighting(base, [{ type: 'reply_received' }]);
  assert.notStrictEqual(noMatch, base, 'no-match path returns a copy');
  assert.equal(base.confidence, 0.5, 'input never mutated');
});

test('#9/#12 serialize/parse round-trips action + evidence containing markdown structure', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'harden-6' }, () => {
    store.writeInstinct(instinct({
      id: 'md',
      action: 'use ## headers and --- rules\nand keep a second line',
      evidence: ['## heading in evidence', '- nested dash'],
    }));
    const got = store.readInstincts('personal').find(i => i.id === 'md');
    assert.equal(got.id, 'md', 'frontmatter is not corrupted by body markdown');
    assert.equal(got.domain, 'process');
    assert.ok(/headers/.test(got.action) && /rules/.test(got.action), 'action content survives');
    assert.ok(/second line/.test(got.action), 'multi-line action content is preserved');
  });
});

test('#6 parseInstinct tolerates a non-string input', () => {
  assert.doesNotThrow(() => store.parseInstinct(null));
  assert.deepEqual(store.parseInstinct(undefined), {});
});
