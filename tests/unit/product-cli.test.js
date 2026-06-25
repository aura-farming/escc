'use strict';

/*
 * The `escc product` operator verbs (ADR-0012), exercised through the CLI
 * dispatcher's run() — mirrors tests/unit/escc-cli.test.js. Hermetic: a fresh
 * ESCC_AGENT_DATA_HOME per test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../../scripts/escc');

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-pcli-'));
  const prev = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prev;
  }
}

function writeJson(home, name, obj) {
  const p = path.join(home, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('product resolve-role maps a job title via the committed vocab', () => {
  const r = run(['product', 'resolve-role', 'Chief Financial Officer']);
  assert.equal(r.code, 0);
  assert.match(r.text, /role: finance/);
  assert.equal(run(['product', 'resolve-role', 'Astronaut']).data.role, 'general');
});

test('product add: a candidate by default, an approved entry with --approved-by', () => {
  withHome((home) => {
    const cand = writeJson(home, 'c.json', { id: 'CLI-C1', type: 'objection', pattern: 'we already have payroll', response: '(candidate)', source_type: 'call' });
    const a = run(['product', 'add', '--input', cand]);
    assert.equal(a.code, 0);
    assert.match(a.text, /candidate/i);
    assert.equal(run(['product', 'candidates']).data.candidates.length, 1);

    const appr = writeJson(home, 'a.json', { id: 'CLI-A1', type: 'claim', text: 'exampleco is STP registered.', segment: 'general', source_type: 'public' });
    const r = run(['product', 'add', '--input', appr, '--approved-by', 'Lucas']);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /approved/i);
    const got = run(['product', 'retrieve', '--segment', 'general', '--type', 'claim']);
    assert.ok(got.data.found && got.data.entries.some(e => e.id === 'CLI-A1'), 'approved entry retrievable');
  });
});

test('product add: a free-text role is rejected at the CLI boundary', () => {
  withHome((home) => {
    const bad = writeJson(home, 'bad.json', { id: 'CLI-B1', type: 'value-prop', text: 'x', role: 'wizard', source_type: 'public' });
    const r = run(['product', 'add', '--input', bad, '--approved-by', 'Lucas']);
    assert.equal(r.code, 1);
    assert.match(r.text, /vocabulary/i);
  });
});

test('product approve promotes a candidate (human gate), then it is gone from candidates', () => {
  withHome((home) => {
    const cand = writeJson(home, 'c.json', { id: 'CLI-PROMO', type: 'pain', role: 'payroll', text: 'mined pain', source_type: 'call' });
    run(['product', 'add', '--input', cand]);
    assert.equal(run(['product', 'approve', '--id', 'CLI-PROMO']).code, 1, 'no --approved-by -> blocked');
    const r = run(['product', 'approve', '--id', 'CLI-PROMO', '--approved-by', 'Lucas']);
    assert.equal(r.code, 0, r.text);
    assert.equal(run(['product', 'candidates']).data.candidates.length, 0);
  });
});

test('product mine --from-transcript writes candidates only', () => {
  withHome((home) => {
    const tf = path.join(home, 't.txt');
    fs.writeFileSync(tf, 'We already have payroll software. Lovely day. It is too expensive right now.');
    const r = run(['product', 'mine', '--from-transcript', tf]);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /Mined 2 candidate/);
    const cands = run(['product', 'candidates']).data.candidates;
    assert.equal(cands.length, 2);
    assert.ok(cands.every(c => c.approved === false && c.untrusted === true), 'mined rows are candidates only');
  });
});

test('product gaps surfaces clean-miss gaps logged by retrieve', () => {
  withHome(() => {
    run(['product', 'retrieve', '--role', 'payroll', '--segment', 'aged care', '--type', 'objection']);
    const g = run(['product', 'gaps']);
    assert.equal(g.code, 0);
    assert.equal(g.data.gaps.length, 1);
    assert.equal(g.data.gaps[0].role, 'payroll');
  });
});

test('product: unknown action is a clean error, not a throw', () => {
  const r = run(['product', 'frobnicate']);
  assert.equal(r.code, 1);
  assert.match(r.text, /unknown action/);
});
