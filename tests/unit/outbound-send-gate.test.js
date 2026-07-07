'use strict';

/**
 * Tests for the FAIL-CLOSED outbound-send-gate and its outbound-review engine.
 * Hermetic: each case points ESCC_AGENT_DATA_HOME at a fresh tmpdir so the
 * JSONL state store is isolated, and restores env afterward.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const review = require('../../scripts/lib/outbound-review');
const dnc = require('../../scripts/lib/do-not-contact');
const gate = require('../../scripts/hooks/outbound-send-gate');

const SEND_TOOL = 'mcp__test__send_email';
const DRAFT_TOOL = 'mcp__claude_ai_Gmail__create_draft';
const SEARCH_TOOL = 'mcp__hubspot__search_crm_objects';
const HUBSPOT_TOOL = 'mcp__hubspot__manage_crm_objects';

function freshStateHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-sendgate-'));
}

/** Run fn with ESCC env overrides applied, then restore. */
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

function gateInput(toolName, toolInput, sessionId) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: sessionId || 'sess-1',
    tool_name: toolName,
    tool_input: toolInput || {},
  });
}

// --- engine: classification + fingerprint ---

test('classification: sends gated, drafts now gated (v1.1.0), reads allow-listed', () => {
  const config = review.loadOutboundToolsConfig();
  assert.equal(review.classifyTool(SEND_TOOL, config), 'send');
  assert.equal(review.classifyTool('mcp__claude_ai_Zapier__execute_zapier_write_action', config), 'send');
  assert.equal(review.classifyTool(SEARCH_TOOL, config), 'allow');
  assert.equal(review.classifyTool('Read', config), 'other');
  // v1.1.0: a draft is no longer plain-allow — classifyOutbound gates it.
  assert.equal(review.classifyOutbound(DRAFT_TOOL, { to: 'a@b.example', subject: 'S', body: 'B' }, config).kind, 'draft');
});

test('fingerprintOutbound is stable for same content and differs for different content', () => {
  const a = review.fingerprintOutbound(SEND_TOOL, { to: 'x@y.example', subject: 'Hi', body: 'Hello' });
  const b = review.fingerprintOutbound(SEND_TOOL, { to: 'x@y.example', subject: 'Hi', body: 'Hello' });
  const c = review.fingerprintOutbound(SEND_TOOL, { to: 'x@y.example', subject: 'Hi', body: 'Different' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// --- gate behavior ---

// --- v1.1.0: drafts + HubSpot outbound email are gated at the tool boundary ---

test('ROGUE AGENT: an unreviewed Gmail draft is BLOCKED (the v1.1.0 fix)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run(gateInput(DRAFT_TOOL, { to: 'a@b.example', subject: 'Hi', body: 'Hello Sam' }));
    assert.ok(result && result.exitCode === 2, 'a direct, unreviewed draft must block');
    assert.match(result.stderr, /has not passed escc review/i);
  });
});

test('BLESSED PATH: a Gmail draft passes once an approval token is recorded', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'a@b.example', subject: 'Thursday', body: 'Hi Sam, looking forward to Thursday.' };
    const key = review.outboundContentKey(review.extractOutboundPayload(DRAFT_TOOL, toolInput));
    review.recordApproval({ sessionId: 'sess-1', key, recipient: 'a@b.example', confidence: 0.95 });
    const result = gate.run(gateInput(DRAFT_TOOL, toolInput));
    assert.equal(result, undefined, 'an approved draft should pass through');
  });
});

test('a benign HubSpot TASK create is NOT blocked (hard constraint)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run(gateInput(HUBSPOT_TOOL, { objectType: 'tasks', properties: { hs_task_subject: 'Call Sam back next week' } }));
    assert.equal(result, undefined, 'creating a normal follow-up task must never be blocked');
  });
});

test('HubSpot reads / notes / deals also pass through untouched', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    assert.equal(gate.run(gateInput(SEARCH_TOOL, { objectType: 'contacts' })), undefined);
    assert.equal(gate.run(gateInput(HUBSPOT_TOOL, { objectType: 'notes', properties: { hs_note_body: 'Spoke to Sam' } })), undefined);
    assert.equal(gate.run(gateInput(HUBSPOT_TOOL, { objectType: 'deals', properties: { dealstage: 'qualifiedtobuy' } })), undefined);
  });
});

test('a HubSpot OUTBOUND email engagement is gated, and passes once approved', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = {
      objectType: 'emails',
      properties: { hs_email_direction: 'EMAIL', hs_email_to_email: 'a@b.example', hs_email_subject: 'Hi', hs_email_html: 'Hi Sam, a quick note on reporting.' },
    };
    const blocked = gate.run(gateInput(HUBSPOT_TOOL, toolInput));
    assert.ok(blocked && blocked.exitCode === 2, 'an unreviewed outbound email must block');

    const key = review.outboundContentKey(review.extractOutboundPayload(HUBSPOT_TOOL, toolInput));
    review.recordApproval({ key, recipient: 'a@b.example', confidence: 0.95 });
    assert.equal(gate.run(gateInput(HUBSPOT_TOOL, toolInput)), undefined, 'an approved outbound email should pass');
  });
});

test('an approved draft to a do-not-contact recipient is STILL blocked', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'sam@acme.example', subject: 'Hi', body: 'Hi Sam' };
    const key = review.outboundContentKey(review.extractOutboundPayload(DRAFT_TOOL, toolInput));
    review.recordApproval({ key, recipient: 'sam@acme.example', confidence: 0.95 });
    dnc.recordDoNotContact({ key: 'sam@acme.example', scope: 'contact', reason: 'asked us to stop' });
    const result = gate.run(gateInput(DRAFT_TOOL, toolInput));
    assert.ok(result && result.exitCode === 2, 'blocklist beats an approval token');
    assert.match(result.stderr, /do-not-contact/i);
  });
});

test('gate BLOCKS a live send with no review-evidence marker (fail-closed)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.example', subject: 'S', body: 'B' }));
    assert.ok(result && result.exitCode === 2, 'unreviewed send must block');
    assert.match(result.stderr, /no review-evidence marker/i);
  });
});

test('gate ALLOWS a live send once a valid review marker is recorded', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'a@b.example', subject: 'S', body: 'B' };
    const fingerprint = review.fingerprintOutbound(SEND_TOOL, toolInput);
    review.recordReview({ sessionId: 'sess-1', fingerprint, confidence: 0.95, verdict: 'approved' });
    const result = gate.run(gateInput(SEND_TOOL, toolInput));
    assert.equal(result, undefined, 'reviewed send should pass through');
    // and the allow is recorded for bulk counting
    assert.equal(review.countSends({ sessionId: 'sess-1' }), 1);
  });
});

test('gate BLOCKS when the review confidence is below the gate (>80%)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'a@b.example', subject: 'S', body: 'B' };
    const fingerprint = review.fingerprintOutbound(SEND_TOOL, toolInput);
    review.recordReview({ sessionId: 'sess-1', fingerprint, confidence: 0.5, verdict: 'approved' });
    const result = gate.run(gateInput(SEND_TOOL, toolInput));
    assert.ok(result && result.exitCode === 2, 'low-confidence review must not satisfy the gate');
  });
});

test('gate enforces the bulk send cap (ESCC_BULK_SEND_MAX)', () => {
  const home = freshStateHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_BULK_SEND_MAX: '2' }, () => {
    // seed the cap with two recorded allows for this session
    review.recordSendDecision({ sessionId: 'bulk', fingerprint: 'f1', decision: 'allow' });
    review.recordSendDecision({ sessionId: 'bulk', fingerprint: 'f2', decision: 'allow' });
    const toolInput = { to: 'a@b.example', subject: 'S', body: 'B' };
    const fingerprint = review.fingerprintOutbound(SEND_TOOL, toolInput);
    review.recordReview({ sessionId: 'bulk', fingerprint, confidence: 0.99, verdict: 'approved' });
    const result = gate.run(gateInput(SEND_TOOL, toolInput, 'bulk'));
    assert.ok(result && result.exitCode === 2, 'over-cap send must block even with a valid review');
    assert.match(result.stderr, /bulk send cap/i);
  });
});

test('gate BLOCKS on a truncated payload', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.example' }), { truncated: true });
    assert.ok(result && result.exitCode === 2, 'truncated payload must block (fail-closed)');
    assert.match(result.stderr, /truncated/i);
  });
});

test('gate BLOCKS when the tool cannot be identified (fail-closed)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run('this is not json', {});
    assert.ok(result && result.exitCode === 2, 'unidentifiable tool must block');
  });
});

test('gate passes through when ESCC_OUTBOUND_GATE=off (documented escape hatch)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome(), ESCC_OUTBOUND_GATE: 'off' }, () => {
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.example', body: 'B' }));
    assert.equal(result, undefined, 'gate off should pass through');
  });
});

test('gate fails CLOSED when the state store cannot be written (internal error)', () => {
  // An unwritable data home makes recordSendDecision throw → caught → block.
  withEnv({ ESCC_AGENT_DATA_HOME: '/dev/null/nope' }, () => {
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.example', body: 'B' }));
    assert.ok(result && result.exitCode === 2, 'state-store failure must block, not open');
  });
});
