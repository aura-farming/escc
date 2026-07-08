'use strict';

/*
 * Tests for `escc outcome void <id>` — rollback of a poisoned/fabricated
 * outcome (v1.9.0, ADR-0019 WS-D.4). Voiding appends a same-id replacement row
 * with payload.voided=true; because listOutcomes filters voided rows at the
 * source, the rollback is honored by every consumer (distill weighting,
 * account-truth counts, `outcome summary`) at once.
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
  return { ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-void-')) };
}

test('voiding an outcome removes it from listOutcomes everywhere', () => {
  withEnv(freshHome(), () => {
    const rec = escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1']);
    const id = rec.data.id;

    const db1 = createStateStoreSync();
    assert.equal(db1.listOutcomes().length, 1, 'the outcome is live before voiding');
    db1.close();

    const res = escc.run(['outcome', 'void', id]);
    assert.equal(res.code, 0);
    assert.ok(/voided/i.test(res.text));

    const db2 = createStateStoreSync();
    assert.equal(db2.listOutcomes().length, 0, 'voided outcome excluded from the ledger');
    assert.equal(db2.listOutcomes({ includeVoided: true }).length, 1, 'still present when explicitly included');
    db2.close();
  });
});

test('voiding is idempotent and unknown ids are refused', () => {
  withEnv(freshHome(), () => {
    const rec = escc.run(['outcome', 'record', '--type', 'reply_received', '--account', 'company:1']);
    escc.run(['outcome', 'void', rec.data.id]);
    const again = escc.run(['outcome', 'void', rec.data.id]);
    assert.equal(again.code, 0);
    assert.ok(/already voided/i.test(again.text));

    const missing = escc.run(['outcome', 'void', 'no-such-id']);
    assert.equal(missing.code, 1);
  });
});
