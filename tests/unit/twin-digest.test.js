'use strict';

/*
 * Tests for `escc twin` — the read-only "what did the twin learn this week"
 * digest (v1.9.0, ADR-0019 WS-D.7): folds new-since-N-days counts across the
 * twin's stores and points at each correction surface. Fail-soft and never
 * mutating. Hermetic: ESCC_AGENT_DATA_HOME points at a tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const escc = require('../../scripts/escc.js');
const twin = require('../../scripts/lib/twin-digest');
const worklistStore = require('../../scripts/lib/worklist-store');

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
  return { ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-twin-')) };
}

test('twin digest folds recent activity and points at correction surfaces', () => {
  withEnv(freshHome(), () => {
    escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1']);
    worklistStore.addPreparedItem({ account: 'company:2', kind: 'call_prep', meetingTime: '2026-07-09T10:00:00Z' });

    const res = escc.run(['twin']);
    assert.equal(res.code, 0);
    assert.equal(res.data.outcomesTotal, 1, 'the recorded outcome is counted');
    assert.equal(res.data.outcomes.reply_received, 1);
    assert.equal(res.data.preparedOpen, 1, 'the prepared item is counted');
    assert.ok(/instinct-status/.test(res.text), 'points at the instinct review surface');
    assert.ok(/escc outcome void/.test(res.text), 'points at the outcome rollback surface');
    assert.ok(/human gate/i.test(res.text), 'states the human-gate honesty line');
  });
});

test('a voided outcome drops out of the twin digest', () => {
  withEnv(freshHome(), () => {
    const rec = escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1']);
    escc.run(['outcome', 'void', rec.data.id]);
    assert.equal(twin.buildTwinDigest().outcomesTotal, 0, 'voided outcomes are not counted');
  });
});

test('twin digest is empty-safe on a fresh workspace', () => {
  withEnv(freshHome(), () => {
    const res = escc.run(['twin']);
    assert.equal(res.code, 0);
    assert.equal(res.data.outcomesTotal, 0);
    assert.equal(res.data.preparedOpen, 0);
  });
});
