'use strict';

/*
 * Tests for thread-keyed reply auto-attest dedupe (v1.9.0, ADR-0019).
 *
 * inbox-triage auto-attests a genuine inbound reply as reply_received. Because
 * a thread can be triaged more than once, `escc outcome record --thread <id>`
 * dedupes on a fingerprint (type + canonical account + thread) so the same
 * reply never inflates the ledger, escc truth counts, or instinct confidence.
 * Without --thread, behavior is unchanged (always insert).
 *
 * Hermetic: ESCC_AGENT_DATA_HOME points at a tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const escc = require('../../scripts/escc.js');
const { createStateStoreSync } = require('../../scripts/lib/state-store');

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
  return { ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-attest-')) };
}

function countOutcomes() {
  const db = createStateStoreSync();
  try {
    return db.listOutcomes().length;
  } finally {
    db.close();
  }
}

test('the same thread attested twice collapses to one row', () => {
  withEnv(freshHome(), () => {
    const first = escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1', '--thread', 'thr-abc']);
    assert.equal(first.code, 0);
    const second = escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1', '--thread', 'thr-abc']);
    assert.equal(second.code, 0);
    assert.ok(/already attested/i.test(second.text), 'second attest is a no-op success');
    assert.equal(countOutcomes(), 1, 'only one ledger row');
  });
});

test('different threads for the same account attest separately', () => {
  withEnv(freshHome(), () => {
    escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1', '--thread', 'thr-1']);
    escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1', '--thread', 'thr-2']);
    assert.equal(countOutcomes(), 2, 'two distinct replies, two rows');
  });
});

test('the thread id is stored in payload, never prospect prose', () => {
  withEnv(freshHome(), () => {
    const res = escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1', '--thread', 'thr-xyz']);
    assert.equal(res.data.payload.thread_id, 'thr-xyz');
    assert.ok(res.data.fingerprint, 'a dedupe fingerprint was set');
  });
});

test('without --thread, attests are not deduped (backward compatible)', () => {
  withEnv(freshHome(), () => {
    escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1']);
    escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1']);
    assert.equal(countOutcomes(), 2, 'no --thread means no dedupe key, both insert');
  });
});
