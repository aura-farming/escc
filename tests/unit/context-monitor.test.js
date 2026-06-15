'use strict';

/*
 * Unit tests for scripts/hooks/context-monitor.js (post:context-monitor).
 *
 * Hermetic: each test uses a unique session id, writes a controlled bridge via
 * the session-bridge primitive, and cleans up the bridge + debounce files. The
 * pure evaluation/loop functions are tested directly without any filesystem.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/context-monitor');
const { getBridgePath, writeBridgeAtomic } = require('../../scripts/lib/session-bridge');

function uniqueSession() {
  return `test${process.pid}${Math.random().toString(36).slice(2, 10)}`;
}

function postInput(sessionId) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: {},
    session_id: sessionId,
  });
}

function warnPath(sessionId) {
  return path.join(os.tmpdir(), `escc-ctx-warn-${sessionId}.json`);
}

function cleanup(sessionId) {
  try { fs.rmSync(getBridgePath(sessionId), { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(warnPath(sessionId), { force: true }); } catch { /* ignore */ }
}

/** Build a bridge with a fresh last_timestamp so the stale guard does not fire. */
function freshBridge(extra) {
  return Object.assign(
    {
      session_id: 's',
      total_cost_usd: 0,
      files_modified_count: 0,
      recent_tools: [],
      last_timestamp: new Date().toISOString(),
      context_remaining_pct: null,
    },
    extra || {}
  );
}

function clearEnv() {
  delete process.env.ESCC_CONTEXT_MONITOR_COST_WARNINGS;
}

test('costWarningsEnabled defaults ON and honors ESCC_CONTEXT_MONITOR_COST_WARNINGS', () => {
  clearEnv();
  assert.equal(hook.costWarningsEnabled(), true);
  assert.equal(hook.costWarningsEnabled({ ESCC_CONTEXT_MONITOR_COST_WARNINGS: '0' }), false);
  assert.equal(hook.costWarningsEnabled({ ESCC_CONTEXT_MONITOR_COST_WARNINGS: 'off' }), false);
  assert.equal(hook.costWarningsEnabled({ ESCC_CONTEXT_MONITOR_COST_WARNINGS: 'true' }), true);
  assert.equal(hook.costWarningsEnabled({ ESCC_CONTEXT_MONITOR_COST_WARNINGS: '' }), true);
});

test('evaluateConditions emits a context-critical warning at low remaining pct', () => {
  const warnings = hook.evaluateConditions(freshBridge({ context_remaining_pct: 20 }));
  assert.ok(warnings.length >= 1);
  assert.equal(warnings[0].type, 'context');
  assert.equal(warnings[0].severity, 3);
  assert.match(warnings[0].message, /CONTEXT CRITICAL/);
});

test('evaluateConditions suppresses cost warnings when disabled', () => {
  const bridge = freshBridge({ total_cost_usd: 99 });
  const enabled = hook.evaluateConditions(bridge, { costWarnings: true });
  const disabled = hook.evaluateConditions(bridge, { costWarnings: false });
  assert.ok(enabled.some(w => w.type === 'cost'));
  assert.ok(!disabled.some(w => w.type === 'cost'));
});

test('detectLoop fires when a tool+hash repeats >= 3 times', () => {
  const repeated = [
    { tool: 'Bash', hash: 'aaa' },
    { tool: 'Bash', hash: 'aaa' },
    { tool: 'Bash', hash: 'aaa' },
  ];
  const loop = hook.detectLoop(repeated);
  assert.equal(loop.detected, true);
  assert.equal(loop.tool, 'Bash');
  assert.equal(loop.count, 3);
  assert.equal(hook.detectLoop([{ tool: 'A', hash: '1' }]).detected, false);
});

test('run returns additionalContext on a new warning condition', () => {
  clearEnv();
  const session = uniqueSession();
  cleanup(session);
  writeBridgeAtomic(session, freshBridge({ session_id: session, files_modified_count: 50 }));
  const result = hook.run(postInput(session));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /SCOPE WARNING/);
  assert.ok(!('exitCode' in result));
  cleanup(session);
});

test('run debounces the same warning text (undefined on repeat)', () => {
  clearEnv();
  const session = uniqueSession();
  cleanup(session);
  writeBridgeAtomic(session, freshBridge({ session_id: session, files_modified_count: 50 }));
  const first = hook.run(postInput(session));
  assert.ok(first && first.additionalContext);
  const second = hook.run(postInput(session)); // identical condition -> suppressed
  assert.equal(second, undefined);
  cleanup(session);
});

test('run re-emits when escalating to critical', () => {
  clearEnv();
  const session = uniqueSession();
  cleanup(session);
  // First: a non-critical scope warning.
  writeBridgeAtomic(session, freshBridge({ session_id: session, files_modified_count: 50 }));
  assert.ok(hook.run(postInput(session)).additionalContext);
  // Then: context critical (severity 3) -> must surface despite an active warning.
  writeBridgeAtomic(
    session,
    freshBridge({ session_id: session, files_modified_count: 50, context_remaining_pct: 10 })
  );
  const escalated = hook.run(postInput(session));
  assert.ok(escalated && /CONTEXT CRITICAL/.test(escalated.additionalContext));
  cleanup(session);
});

test('run is silent (undefined) when no bridge exists', () => {
  clearEnv();
  const session = uniqueSession();
  cleanup(session);
  assert.equal(hook.run(postInput(session)), undefined);
  cleanup(session);
});

test('run nulls context warnings when the bridge is stale (cost still applies)', () => {
  clearEnv();
  const session = uniqueSession();
  cleanup(session);
  const staleTs = new Date(Date.now() - 120 * 1000).toISOString(); // > 60s old
  writeBridgeAtomic(session, {
    session_id: session,
    last_timestamp: staleTs,
    context_remaining_pct: 10, // would be critical if not stale
    total_cost_usd: 0,
    files_modified_count: 0,
    recent_tools: [],
  });
  // Context is suppressed (stale) and no other condition -> undefined.
  assert.equal(hook.run(postInput(session)), undefined);
  cleanup(session);
});

test('run never blocks and fails open (undefined) on garbage input', () => {
  clearEnv();
  const result = hook.run('not json {');
  assert.equal(result, undefined);
});
