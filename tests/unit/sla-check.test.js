'use strict';

/*
 * Tests for the stop:sla-check hook (A.6): WARN-ONLY surfacing of breached
 * response/deadline SLAs derived from open-loop timestamps — overdue promises
 * and active-account loops awaiting a response beyond ESCC_RESPONSE_SLA_HOURS.
 * Never blocks. Hermetic.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/sla-check');
const accountMemory = require('../../scripts/lib/account-memory');
const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-slacheck-'));
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

function stopInput(sessionId) {
  return JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId });
}

test('flags an overdue promise as a breached deadline SLA', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    const store = createStateStoreSync();
    try {
      store.upsertPromise({ id: 'p1', account_id: 'acme', text: 'Send pricing', due_date: '2020-01-01' });
    } finally {
      store.close();
    }
    const result = hook.run(stopInput('s1'));
    assert.ok(result && /SLA/i.test(result.additionalContext), 'mentions SLA');
    assert.ok(/overdue|breach/i.test(result.additionalContext));
    assert.ok(result.exitCode !== 2, 'never blocks');
  });
});

test('flags an active-account inbound loop awaiting response beyond the SLA window', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: 'acme', ESCC_RESPONSE_SLA_HOURS: '24' }, () => {
    accountMemory.appendEvent('acme', { type: 'inbound', text: 'Buyer replied with questions', status: 'open', ts: '2020-01-01T00:00:00.000Z' });
    const result = hook.run(stopInput('s2'));
    assert.ok(result && /response|awaiting/i.test(result.additionalContext), 'flags the response-SLA breach');
  });
});

test('stays silent when no SLA is breached', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    const store = createStateStoreSync();
    try {
      store.upsertPromise({ id: 'p-future', account_id: 'acme', text: 'Later thing', due_date: '2099-01-01' });
    } finally {
      store.close();
    }
    assert.equal(hook.run(stopInput('s3')), undefined);
  });
});

test('never blocks — fails open on internal error', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: '/dev/null/nope' }, () => {
    const result = hook.run(stopInput('s4'));
    assert.ok(result === undefined || (result && result.exitCode === 0));
    assert.ok(!result || result.exitCode !== 2);
  });
});

test('does not flag a rep promise as a response-SLA breach (no double-count)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: 'acme', ESCC_RESPONSE_SLA_HOURS: '24' }, () => {
    // A rep's own promise persisted to account memory (type:'promise', not yet due)
    // is a DEADLINE item, never an inbound loop awaiting the rep's response.
    accountMemory.appendEvent('acme', {
      id: 'pr1', type: 'promise', text: 'I will send the deck', status: 'open',
      due_date: '2099-01-01', ts: '2020-01-01T00:00:00.000Z',
    });
    assert.equal(hook.run(stopInput('s5')), undefined, 'a not-yet-due promise is not a response breach');
  });
});
