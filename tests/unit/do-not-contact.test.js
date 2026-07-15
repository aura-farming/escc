'use strict';

/**
 * Tests for the do-not-contact blocklist (scripts/lib/do-not-contact.js) that
 * the timing/contactability gates write and the send-gate hook reads. Hermetic:
 * each case points ESCC_AGENT_DATA_HOME at a fresh tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const dnc = require('../../scripts/lib/do-not-contact');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-dnc-'));
}
function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return fn(); } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('normalizeContactKey lowercases and trims', () => {
  assert.equal(dnc.normalizeContactKey('  Sam@company.example '), 'sam@company.example');
});

test('an indefinite block is active forever', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    dnc.recordDoNotContact({ key: 'sam@company.example', scope: 'contact', reason: 'said do not contact' });
    const hit = dnc.findActiveBlock({ key: 'Sam@company.example', now: '2030-01-01' });
    assert.ok(hit, 'indefinite block is still active years later');
    assert.equal(hit.not_before, null);
  });
});

test('a not-before block is active before the date and clears after it', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    dnc.recordDoNotContact({ key: 'a@b.example', reason: 'call back in six weeks', notBefore: '2026-07-13T00:00:00Z' });
    assert.ok(dnc.findActiveBlock({ key: 'a@b.example', now: '2026-06-23' }), 'blocked before the window elapses');
    assert.equal(dnc.findActiveBlock({ key: 'a@b.example', now: '2026-08-01' }), null, 'unblocked after the window');
  });
});

test('clearing a block lifts it (last-write-wins by key)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    dnc.recordDoNotContact({ key: 'a@b.example', reason: 'declined' });
    assert.ok(dnc.findActiveBlock({ key: 'a@b.example' }), 'blocked after record');
    dnc.clearDoNotContact({ key: 'a@b.example', sessionId: 's2' });
    assert.equal(dnc.findActiveBlock({ key: 'a@b.example' }), null, 'cleared block is no longer active');
  });
});

test('account-scoped blocks are stored and listed', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    dnc.recordDoNotContact({ key: 'example-co-123', scope: 'account', reason: 'open deal' });
    const rows = dnc.listDoNotContact();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scope, 'account');
    assert.equal(rows[0].key, 'example-co-123');
  });
});

test('findActiveBlock returns null for an unknown contact', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    assert.equal(dnc.findActiveBlock({ key: 'nobody@nowhere.example' }), null);
  });
});
