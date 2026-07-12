'use strict';

/*
 * Tests for C2 auto-mine hardening (v1.9.0, ADR-0019):
 *   - `escc product mine --from-transcript` REFUSES a quarantined path (the
 *     Read-matcher quarantine hook cannot see a Bash-invoked CLI read, so the
 *     ban must be enforced in the verb, not just skill prose);
 *   - ingestCandidates caps accepted candidates (ESCC_MINE_MAX) so auto-mining
 *     cannot flood the operator review queue, and surfaces the dropped count.
 * Hermetic: ESCC_AGENT_DATA_HOME points at a tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const escc = require('../../scripts/escc.js');
const productMine = require('../../scripts/lib/product-mine');

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
  return { ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-mine-')) };
}

test('mine --from-transcript refuses a quarantined path', () => {
  withEnv({ ...freshHome(), ESCC_QUARANTINE_CONTEXT: undefined }, () => {
    const res = escc.run(['product', 'mine', '--from-transcript', '/tmp/inbound/prospect-call.eml']);
    assert.equal(res.code, 1, 'refused');
    assert.ok(/quarantine/i.test(res.text), 'explains the quarantine reason');
    assert.ok(/transcript-analyzer/.test(res.text), 'points at the compliant route');
  });
});

test('mine --from-transcript allows a non-quarantined path', () => {
  withEnv({ ...freshHome(), ESCC_QUARANTINE_CONTEXT: undefined }, () => {
    const f = path.join(os.tmpdir(), `escc-mine-clean-${process.pid}.txt`);
    fs.writeFileSync(f, "That's too expensive for us right now. How does onboarding work?");
    const res = escc.run(['product', 'mine', '--from-transcript', f]);
    assert.equal(res.code, 0, 'a clean path is mined');
    fs.unlinkSync(f);
  });
});

test('ingestCandidates caps at ESCC_MINE_MAX and reports the drop', () => {
  withEnv({ ...freshHome(), ESCC_MINE_MAX: '5' }, () => {
    const items = Array.from({ length: 30 }, (_v, i) => ({ type: 'objection', pattern: `p${i}`, response: `r${i}` }));
    const stored = productMine.ingestCandidates(items, { sourceType: 'call', sourceRef: 'x' });
    assert.equal(stored.length, 5, 'accepted rows capped');
    assert.equal(stored.dropped, 25, 'surplus reported, not silently dropped');
  });
});
