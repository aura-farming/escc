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
const gate = require('../../scripts/hooks/outbound-send-gate');

const SEND_TOOL = 'mcp__test__send_email';
const DRAFT_TOOL = 'mcp__claude_ai_Gmail__create_draft';
const SEARCH_TOOL = 'mcp__hubspot__search_crm_objects';

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

test('classifyTool: send tools gated, draft/search allow-listed, unknown is other', () => {
  const config = review.loadOutboundToolsConfig();
  assert.equal(review.classifyTool(SEND_TOOL, config), 'send');
  assert.equal(review.classifyTool('mcp__claude_ai_Zapier__execute_zapier_write_action', config), 'send');
  assert.equal(review.classifyTool(DRAFT_TOOL, config), 'allow');
  assert.equal(review.classifyTool(SEARCH_TOOL, config), 'allow');
  assert.equal(review.classifyTool('Read', config), 'other');
  assert.equal(review.classifyTool('', config), 'other');
});

test('fingerprintOutbound is stable for same content and differs for different content', () => {
  const a = review.fingerprintOutbound(SEND_TOOL, { to: 'x@y.com', subject: 'Hi', body: 'Hello' });
  const b = review.fingerprintOutbound(SEND_TOOL, { to: 'x@y.com', subject: 'Hi', body: 'Hello' });
  const c = review.fingerprintOutbound(SEND_TOOL, { to: 'x@y.com', subject: 'Hi', body: 'Different' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// --- gate behavior ---

test('gate passes through an allow-listed draft tool', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run(gateInput(DRAFT_TOOL, { to: 'a@b.com', body: 'hi' }));
    assert.equal(result, undefined, 'draft tool should pass through');
  });
});

test('gate BLOCKS a live send with no review-evidence marker (fail-closed)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.com', subject: 'S', body: 'B' }));
    assert.ok(result && result.exitCode === 2, 'unreviewed send must block');
    assert.match(result.stderr, /no review-evidence marker/i);
  });
});

test('gate ALLOWS a live send once a valid review marker is recorded', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'a@b.com', subject: 'S', body: 'B' };
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
    const toolInput = { to: 'a@b.com', subject: 'S', body: 'B' };
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
    const toolInput = { to: 'a@b.com', subject: 'S', body: 'B' };
    const fingerprint = review.fingerprintOutbound(SEND_TOOL, toolInput);
    review.recordReview({ sessionId: 'bulk', fingerprint, confidence: 0.99, verdict: 'approved' });
    const result = gate.run(gateInput(SEND_TOOL, toolInput, 'bulk'));
    assert.ok(result && result.exitCode === 2, 'over-cap send must block even with a valid review');
    assert.match(result.stderr, /bulk send cap/i);
  });
});

test('gate BLOCKS on a truncated payload', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.com' }), { truncated: true });
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
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.com', body: 'B' }));
    assert.equal(result, undefined, 'gate off should pass through');
  });
});

test('gate fails CLOSED when the state store cannot be written (internal error)', () => {
  // An unwritable data home makes recordSendDecision throw → caught → block.
  withEnv({ ESCC_AGENT_DATA_HOME: '/dev/null/nope' }, () => {
    const result = gate.run(gateInput(SEND_TOOL, { to: 'a@b.com', body: 'B' }));
    assert.ok(result && result.exitCode === 2, 'state-store failure must block, not open');
  });
});
