'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/suggest-compact');

// Each test uses a unique session id so its counter file is isolated.
function uniqueSession() {
  return `test${process.pid}${Math.random().toString(36).slice(2, 10)}`;
}

function preToolInput(sessionId) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'foo.md' },
    session_id: sessionId,
  });
}

function counterPath(sessionId) {
  return path.join(os.tmpdir(), `escc-tool-count-${sessionId}`);
}

function cleanup(sessionId) {
  try { fs.rmSync(counterPath(sessionId), { force: true }); } catch { /* ignore */ }
}

function clearEnv() {
  delete process.env.ESCC_COMPACT_THRESHOLD;
  delete process.env.ESCC_COMPACT_STATE_TTL_DAYS;
}

test('getThreshold defaults to 50 and honors ESCC_COMPACT_THRESHOLD', () => {
  clearEnv();
  assert.equal(hook.getThreshold(), 50);
  process.env.ESCC_COMPACT_THRESHOLD = '5';
  assert.equal(hook.getThreshold(), 5);
  process.env.ESCC_COMPACT_THRESHOLD = 'garbage';
  assert.equal(hook.getThreshold(), 50);
  clearEnv();
});

test('run is silent (undefined) for counts below the threshold', () => {
  clearEnv();
  process.env.ESCC_COMPACT_THRESHOLD = '3';
  const session = uniqueSession();
  cleanup(session);
  assert.equal(hook.run(preToolInput(session)), undefined); // count 1
  assert.equal(hook.run(preToolInput(session)), undefined); // count 2
  cleanup(session);
  clearEnv();
});

test('run nudges (additionalContext) exactly at the threshold', () => {
  clearEnv();
  process.env.ESCC_COMPACT_THRESHOLD = '3';
  const session = uniqueSession();
  cleanup(session);
  hook.run(preToolInput(session)); // 1
  hook.run(preToolInput(session)); // 2
  const result = hook.run(preToolInput(session)); // 3 == threshold
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /tool calls reached/i);
  assert.match(result.additionalContext, /compact/i);
  cleanup(session);
  clearEnv();
});

test('run nudges every 25 calls after the threshold, silent in between', () => {
  clearEnv();
  process.env.ESCC_COMPACT_THRESHOLD = '2';
  const session = uniqueSession();
  cleanup(session);
  // Walk the counter up. threshold=2 nudges at 2, then at 27, 52, ...
  let lastNudgeCount = null;
  for (let i = 1; i <= 27; i++) {
    const result = hook.run(preToolInput(session));
    if (result && result.additionalContext) {
      lastNudgeCount = i;
      if (i > 2) assert.match(result.additionalContext, /checkpoint/i);
    } else if (i > 2 && i < 27) {
      // between threshold and the next 25-interval, must be silent
      assert.equal(result, undefined);
    }
  }
  assert.equal(lastNudgeCount, 27, 'expected a nudge at count 27 (threshold 2 + 25)');
  cleanup(session);
  clearEnv();
});

test('run never blocks: result has no exitCode 2', () => {
  clearEnv();
  process.env.ESCC_COMPACT_THRESHOLD = '1';
  const session = uniqueSession();
  cleanup(session);
  const result = hook.run(preToolInput(session)); // count 1 == threshold -> nudge
  assert.ok(result && result.additionalContext);
  assert.ok(!('exitCode' in result));
  cleanup(session);
  clearEnv();
});

test('run fails open (undefined) on garbage input', () => {
  clearEnv();
  const result = hook.run('not json {', {});
  // garbage parses to {} -> session 'default'; first call returns undefined unless
  // a stale default counter is at the threshold. Threshold default 50; cleanup default.
  cleanup('default');
  const r2 = hook.run('not json {', {});
  assert.ok(r2 === undefined || (r2 && typeof r2.additionalContext === 'string'));
  cleanup('default');
  clearEnv();
});

test('safeSessionId strips unsafe characters and falls back to default', () => {
  assert.equal(hook.safeSessionId('abc-123_x'), 'abc-123_x');
  assert.equal(hook.safeSessionId('../../etc/passwd'), 'etcpasswd');
  assert.equal(hook.safeSessionId(''), 'default');
  assert.equal(hook.safeSessionId(null), 'default');
});

test('cleanupOldCounters removes stale counters but preserves the active one', () => {
  clearEnv();
  const tempDir = os.tmpdir();
  const active = path.join(tempDir, `escc-tool-count-active${process.pid}`);
  const stale = path.join(tempDir, `escc-tool-count-stale${process.pid}`);
  fs.writeFileSync(active, '1', 'utf8');
  fs.writeFileSync(stale, '1', 'utf8');
  // Backdate the stale file 30 days.
  const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
  fs.utimesSync(stale, old / 1000, old / 1000);

  hook.cleanupOldCounters(tempDir, 14, active);
  assert.ok(fs.existsSync(active), 'active counter preserved');
  assert.ok(!fs.existsSync(stale), 'stale counter removed');
  fs.rmSync(active, { force: true });
  clearEnv();
});
