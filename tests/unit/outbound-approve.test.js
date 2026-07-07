'use strict';

/**
 * Tests for the blessed-path approval engine (scripts/lib/outbound-approve.js):
 * a clean draft is approved (token recorded → the send-gate then ALLOWS it); a
 * blocked draft records NO token and remembers the block; a logged override
 * approves anyway. Hermetic via a fresh ESCC_AGENT_DATA_HOME.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const approve = require('../../scripts/lib/outbound-approve');
const dnc = require('../../scripts/lib/do-not-contact');
const gate = require('../../scripts/hooks/outbound-send-gate');

const DRAFT_TOOL = 'mcp__claude_ai_Gmail__create_draft';

function freshHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-approve-')); }
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
function draftCall(toolInput) {
  return JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: DRAFT_TOOL, tool_input: toolInput, session_id: 's1' });
}

test('approveOutbound approves a clean draft and the send-gate then allows it', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const draft = { to: 'a@b.com', subject: 'Thursday', body: 'You could save your team hours on rostering — worth a quick look?' };
    const records = { notes: [], lead_status: 'new', open_deals: [], priorEngagement: false };
    // `now` must be the REAL current time: recordApproval stamps expires_at =
    // now + TTL (7 days), but the send-gate checks expiry against the actual
    // clock — a past pinned date here becomes a date-bomb once TTL elapses.
    const r = approve.approveOutbound({ draft, records, now: new Date().toISOString() });
    assert.equal(r.approved, true);
    // the matching draft now passes the fail-closed gate
    assert.equal(gate.run(draftCall(draft)), undefined, 'approved draft passes the send-gate');
  });
});

test('approveOutbound blocks a draft to an open-deal account and remembers the block', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const draft = { to: 'x@y.com', subject: 'Hi', body: 'You could cut overtime — keen for a look?' };
    const records = { open_deals: [{ id: 'd1' }], account_id: 'acme-1' };
    const r = approve.approveOutbound({ draft, records });
    assert.equal(r.approved, false);
    assert.ok(r.blocks.some(b => b.gate === 'contactability'));
    assert.ok(dnc.findActiveBlock({ key: 'acme-1' }), 'the account is written to the do-not-contact list');
    // and with no token, the gate blocks the draft too
    assert.ok(gate.run(draftCall(draft)).exitCode === 2);
  });
});

test('a logged override approves despite a block and does NOT persist the block', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const draft = { to: 'x@y.com', subject: 'Hi', body: 'You could cut overtime — keen?' };
    const records = { open_deals: [{ id: 'd1' }], account_id: 'acme-2' };
    const r = approve.approveOutbound({ draft, records, override: 'manager approved — strategic account' });
    assert.equal(r.approved, true);
    assert.equal(r.override, true);
    assert.match(r.overrideReason, /strategic account/);
    assert.equal(dnc.findActiveBlock({ key: 'acme-2' }), null, 'override does not blocklist the account');
    assert.equal(gate.run(draftCall(draft)), undefined, 'overridden draft passes the send-gate');
  });
});

test('an approval row carries the canonical account key and is account-queryable (ADR-0018)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const draft = { to: 'jane@acme.com', subject: 'Hi', body: 'Worth a look at rostering?' };
    const records = { notes: [], lead_status: 'new', open_deals: [], priorEngagement: false, account_id: 'acme.com' };
    const r = approve.approveOutbound({ draft, records, now: new Date().toISOString() });
    assert.equal(r.approved, true);

    const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');
    const store = createStateStoreSync();
    try {
      const rows = store.getGovernanceByAccount('domain_acme.com');
      assert.equal(rows.length, 1, 'approval row found by canonical account key');
      assert.equal(rows[0].event_type, 'outbound_approval');
      assert.equal(rows[0].payload.recipient, 'jane@acme.com');
    } finally {
      store.close();
    }
  });
});

test('with no records.account_id the recipient email resolves the account key', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const draft = { to: 'ops@globex.io', subject: 'Hi', body: 'Quick look at scheduling?' };
    const r = approve.approveOutbound({ draft, records: { notes: [], open_deals: [] }, now: new Date().toISOString() });
    assert.equal(r.approved, true);
    const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');
    const store = createStateStoreSync();
    try {
      assert.equal(store.getGovernanceByAccount('domain_globex.io').length, 1);
    } finally {
      store.close();
    }
  });
});
