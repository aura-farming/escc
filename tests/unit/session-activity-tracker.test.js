'use strict';

/**
 * Tests for the session-activity-tracker hook.
 * Hermetic: each case points ESCC_AGENT_DATA_HOME at a fresh tmpdir so the
 * per-session activity file is isolated, and restores env afterward.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/session-activity-tracker');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-activity-'));
}

/** Run fn with env overrides applied, then restore. */
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

function postInput(toolName, toolInput, sessionId) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: sessionId || 'sess-1',
    tool_name: toolName,
    tool_input: toolInput || {},
  });
}

function endInput(sessionId) {
  return JSON.stringify({
    hook_event_name: 'SessionEnd',
    session_id: sessionId || 'sess-1',
  });
}

function readRecord(home, sessionId) {
  const fp = path.join(home, 'metrics', 'activity', `${sessionId || 'sess-1'}.json`);
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

test('accumulates tool call counts across PostToolUse events', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    hook.run(postInput('Read', { file_path: 'a.js' }));
    hook.run(postInput('Read', { file_path: 'b.js' }));
    hook.run(postInput('Bash', { command: 'ls' }));
    const rec = readRecord(home);
    assert.equal(rec.tool_calls, 3);
    assert.equal(rec.tools.Read, 2);
    assert.equal(rec.tools.Bash, 1);
  });
});

test('dedupes files touched', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    hook.run(postInput('Edit', { file_path: '/repo/x.ts' }));
    hook.run(postInput('Edit', { file_path: '/repo/x.ts' }));
    hook.run(postInput('Write', { file_path: '/repo/y.ts' }));
    const rec = readRecord(home);
    assert.deepEqual(rec.files.sort(), ['/repo/x.ts', '/repo/y.ts']);
  });
});

test('tracks accounts touched from objectType + objectId', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    hook.run(postInput('mcp__hubspot__manage_crm_objects', { objectType: 'deal', objectId: '7788' }));
    const rec = readRecord(home);
    assert.ok(rec.accounts.includes('deal:7788'));
  });
});

test('tracks accounts touched from an email domain', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    hook.run(postInput('mcp__claude_ai_Gmail__create_draft', { to: 'jane@company.test', body: 'hi' }));
    const rec = readRecord(home);
    assert.ok(rec.accounts.includes('domain:company.test'));
  });
});

test('extractReferences pulls typed ids, raw ids, file paths, and domains', () => {
  const refs = hook.extractReferences({
    objectType: 'company',
    objectId: '42',
    file_path: '/repo/z.md',
    notes: 'cc bob@sample.example',
  });
  assert.ok(refs.accounts.includes('company:42'));
  assert.ok(refs.accounts.includes('id:42'));
  assert.ok(refs.accounts.includes('domain:sample.example'));
  assert.ok(refs.files.includes('/repo/z.md'));
});

test('SessionEnd finalizes the record (ended_at + finalized)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    hook.run(postInput('Read', { file_path: 'a.js' }));
    hook.run(endInput());
    const rec = readRecord(home);
    assert.equal(rec.finalized, true);
    assert.ok(typeof rec.ended_at === 'string');
    assert.equal(rec.tool_calls, 1, 'finalize preserves accumulated counts');
  });
});

test('detects SessionEnd via ctx.hookId session-end marker', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    hook.run('{"session_id":"sess-1"}', { hookId: 'session:end:marker' });
    const rec = readRecord(home);
    assert.equal(rec.finalized, true);
  });
});

test('truncated payload still counts the tool call but skips ref-mining', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    hook.run(postInput('Write', { file_path: '/repo/x.ts' }), { truncated: true });
    const rec = readRecord(home);
    assert.equal(rec.tool_calls, 1);
    assert.equal(rec.files.length, 0, 'no ref-mining of a partial payload');
  });
});

test('returns undefined when no session id can be resolved', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome(), ESCC_SESSION_ID: undefined, CLAUDE_SESSION_ID: undefined }, () => {
    const result = hook.run(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} }));
    assert.equal(result, undefined);
  });
});

test('never blocks — internal error fails open with exitCode 0', () => {
  // An unwritable data home makes writeActivity throw → caught → fail open.
  withEnv({ ESCC_AGENT_DATA_HOME: '/dev/null/nope' }, () => {
    const result = hook.run(postInput('Read', { file_path: 'a.js' }));
    assert.ok(result === undefined || (result && result.exitCode === 0));
    assert.ok(!result || result.exitCode !== 2, 'tracker must never block');
  });
});
