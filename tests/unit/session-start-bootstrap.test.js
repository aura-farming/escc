'use strict';

/*
 * Tests for scripts/hooks/session-start-bootstrap.js — the SessionStart
 * plugin-root resolver. The invariant under test: when CLAUDE_PLUGIN_ROOT /
 * ESCC_PLUGIN_ROOT are absent (the exact case the bootstrap exists for), it
 * must SELF-resolve to the plugin tree it lives in — never fall through to a
 * different (possibly stale) install, and never skip the hook when it is
 * itself inside a valid plugin root.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BOOTSTRAP = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'session-start-bootstrap.js');

function runBootstrap(extraEnv) {
  const env = { ...process.env, ...extraEnv };
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.ESCC_PLUGIN_ROOT;
  const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'boot-t1' });
  return spawnSync(process.execPath, [BOOTSTRAP], { input, encoding: 'utf8', env, timeout: 30000 });
}

test('bootstrap SELF-resolves when no env root exists (no stale-install fallthrough)', () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-boot-home-'));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-boot-data-'));
  // HOME points at an EMPTY dir: every ~/.claude candidate is absent, so only
  // self-resolution can produce a SessionStart payload here.
  const res = runBootstrap({ HOME: emptyHome, USERPROFILE: emptyHome, ESCC_AGENT_DATA_HOME: dataHome });
  assert.equal(res.status, 0, `bootstrap exits 0 (stderr: ${res.stderr})`);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (_err) {
    assert.fail(`bootstrap must emit a SessionStart payload, not raw passthrough — got: ${res.stdout.slice(0, 120)}`);
  }
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(
    /\/daily/.test(parsed.hookSpecificOutput.additionalContext),
    'the payload came from THIS tree’s session-start.js (startup /daily nudge present)'
  );
});

test('bootstrap still honors an explicit CLAUDE_PLUGIN_ROOT ahead of self', () => {
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-boot-data2-'));
  const repoRoot = path.join(__dirname, '..', '..');
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot, ESCC_AGENT_DATA_HOME: dataHome };
  const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'boot-t2' });
  const res = spawnSync(process.execPath, [BOOTSTRAP], { input, encoding: 'utf8', env, timeout: 30000 });
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
});
