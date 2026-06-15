'use strict';

/*
 * Unit tests for scripts/hooks/metrics-bridge.js (post:metrics-bridge).
 *
 * Hermetic: each test uses a unique session id (so its bridge file in
 * os.tmpdir() is isolated) and overrides ESCC_AGENT_DATA_HOME to a tmpdir so
 * readSessionCost reads a controlled costs.jsonl. Bridge files are cleaned up.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/metrics-bridge');
const { getBridgePath } = require('../../scripts/lib/session-bridge');

function uniqueSession() {
  return `test${process.pid}${Math.random().toString(36).slice(2, 10)}`;
}

function postInput(sessionId, toolName, toolInput) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: toolName || 'Read',
    tool_input: toolInput || {},
    session_id: sessionId,
  });
}

function cleanupBridge(sessionId) {
  try { fs.rmSync(getBridgePath(sessionId), { force: true }); } catch { /* ignore */ }
}

function readBridgeFile(sessionId) {
  return JSON.parse(fs.readFileSync(getBridgePath(sessionId), 'utf8'));
}

test('run returns { exitCode: 0 } and never blocks', () => {
  const session = uniqueSession();
  cleanupBridge(session);
  const result = hook.run(postInput(session, 'Read', { file_path: 'a.md' }));
  assert.deepEqual(result, { exitCode: 0 });
  cleanupBridge(session);
});

test('run increments tool_count and persists the bridge', () => {
  const session = uniqueSession();
  cleanupBridge(session);
  hook.run(postInput(session, 'Read', { file_path: 'a.md' }));
  hook.run(postInput(session, 'Bash', { command: 'ls' }));
  const bridge = readBridgeFile(session);
  assert.equal(bridge.tool_count, 2);
  assert.equal(bridge.session_id, session);
  assert.ok(bridge.first_timestamp && bridge.last_timestamp);
  cleanupBridge(session);
});

test('run tracks distinct modified files only for write ops, capped uniquely', () => {
  const session = uniqueSession();
  cleanupBridge(session);
  hook.run(postInput(session, 'Write', { file_path: 'one.md', content: 'x' }));
  hook.run(postInput(session, 'Edit', { file_path: 'two.md', new_string: 'y' }));
  hook.run(postInput(session, 'Edit', { file_path: 'one.md', new_string: 'z' })); // dup path
  hook.run(postInput(session, 'Read', { file_path: 'three.md' })); // not a write op
  const bridge = readBridgeFile(session);
  assert.equal(bridge.files_modified_count, 2);
  assert.deepEqual([...bridge.files_modified].sort(), ['one.md', 'two.md']);
  cleanupBridge(session);
});

test('run keeps a bounded recent_tools ring buffer (max 5)', () => {
  const session = uniqueSession();
  cleanupBridge(session);
  for (let i = 0; i < 8; i++) {
    hook.run(postInput(session, 'Bash', { command: `echo ${i}` }));
  }
  const bridge = readBridgeFile(session);
  assert.equal(bridge.recent_tools.length, 5);
  assert.ok(bridge.recent_tools.every(e => e.tool === 'Bash' && typeof e.hash === 'string'));
  cleanupBridge(session);
});

test('run reads cumulative cost from costs.jsonl under ESCC_AGENT_DATA_HOME', () => {
  const session = uniqueSession();
  cleanupBridge(session);
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-mb-'));
  const prevHome = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = dataHome;
  try {
    const metricsDir = path.join(dataHome, 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    const rows = [
      JSON.stringify({ session_id: 'other', cost_usd: 9.99, input_tokens: 1, output_tokens: 1 }),
      JSON.stringify({ session_id: session, cost_usd: 1.5, input_tokens: 100, output_tokens: 50 }),
      'not json {{',
      JSON.stringify({ session_id: session, cost_usd: 2.25, input_tokens: 300, output_tokens: 80 }),
    ];
    fs.writeFileSync(path.join(metricsDir, 'costs.jsonl'), rows.join('\n') + '\n', 'utf8');

    hook.run(postInput(session, 'Read', { file_path: 'a.md' }));
    const bridge = readBridgeFile(session);
    // Last matching row wins; malformed row is skipped.
    assert.equal(bridge.total_cost_usd, 2.25);
    assert.equal(bridge.total_input_tokens, 300);
    assert.equal(bridge.total_output_tokens, 80);
  } finally {
    if (prevHome === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prevHome;
    try { fs.rmSync(dataHome, { recursive: true, force: true }); } catch { /* ignore */ }
    cleanupBridge(session);
  }
});

test('readSessionCost returns zeros when costs.jsonl is absent (fail open)', () => {
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-mb-'));
  const prevHome = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = dataHome;
  try {
    assert.deepEqual(hook.readSessionCost('nope'), { totalCost: 0, totalIn: 0, totalOut: 0 });
  } finally {
    if (prevHome === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prevHome;
    try { fs.rmSync(dataHome, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('run returns exitCode 0 with no session id (nothing to aggregate)', () => {
  const prevEscc = process.env.ESCC_SESSION_ID;
  const prevClaude = process.env.CLAUDE_SESSION_ID;
  delete process.env.ESCC_SESSION_ID;
  delete process.env.CLAUDE_SESSION_ID;
  try {
    const result = hook.run(JSON.stringify({ tool_name: 'Read', tool_input: {} }));
    assert.deepEqual(result, { exitCode: 0 });
  } finally {
    if (prevEscc !== undefined) process.env.ESCC_SESSION_ID = prevEscc;
    if (prevClaude !== undefined) process.env.CLAUDE_SESSION_ID = prevClaude;
  }
});

test('run fails open (exitCode 0) on garbage input', () => {
  const result = hook.run('not json {');
  assert.deepEqual(result, { exitCode: 0 });
});

test('hashToolCall distinguishes different edits to the same file', () => {
  const a = hook.hashToolCall('Edit', { file_path: 'x.md', new_string: 'aaa' });
  const b = hook.hashToolCall('Edit', { file_path: 'x.md', new_string: 'bbb' });
  assert.notEqual(a, b);
  // Same input is stable.
  assert.equal(a, hook.hashToolCall('Edit', { file_path: 'x.md', new_string: 'aaa' }));
});

test('extractFilePaths pulls file_path and edits[].file_path', () => {
  assert.deepEqual(hook.extractFilePaths({ file_path: 'a.md' }), ['a.md']);
  assert.deepEqual(
    hook.extractFilePaths({ edits: [{ file_path: 'b.md' }, { file_path: 'c.md' }, {}] }),
    ['b.md', 'c.md']
  );
  assert.deepEqual(hook.extractFilePaths(null), []);
});
