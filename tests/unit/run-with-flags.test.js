/*
 * Tests for scripts/hooks/run-with-flags.js — the ESCC hook dispatch runner.
 *
 * Covers the #2222 fail-open-on-oversized-stdin regression (ported from ECC's
 * run-with-flags-truncation.test.js) plus ESCC-specific behavior:
 *   - ESCC_HOOK_INPUT_MAX_BYTES makes the stdin cap configurable
 *   - ESCC_HOOK_PROFILE / ESCC_DISABLED_HOOKS gating
 *   - path-traversal rejection (fail-open echo)
 *
 * Hermetic: a throwaway CLAUDE_PLUGIN_ROOT holds fixture hooks, so the test
 * does NOT depend on the (not-yet-built) ~22 real hook scripts.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const runner = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');
const DEFAULT_MAX_STDIN = 1024 * 1024;

// --- Hermetic fixture plugin root with fixture hooks -----------------------

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-rwf-'));

// A pass-through hook: exports run() that returns undefined, so the runner
// echoes the raw payload back (the normal "no opinion" path).
fs.writeFileSync(
  path.join(fixtureRoot, 'noop-hook.js'),
  "'use strict';\nfunction run() { return undefined; }\nmodule.exports = { run };\n"
);

// A blocking hook: exports run() that always returns exit 2 with empty stdout,
// regardless of truncation — simulates a fail-closed security hook.
fs.writeFileSync(
  path.join(fixtureRoot, 'block-hook.js'),
  "'use strict';\nfunction run() { return { exitCode: 2, stdout: '' }; }\nmodule.exports = { run };\n"
);

// A context hook: returns { additionalContext }. The dispatcher must stamp the
// ACTUAL firing event onto the hookSpecificOutput, not a hardcoded PreToolUse.
fs.writeFileSync(
  path.join(fixtureRoot, 'ctx-hook.js'),
  "'use strict';\nfunction run() { return { additionalContext: 'NUDGE: confirm the drafts are sent' }; }\nmodule.exports = { run };\n"
);

// A hook that throws at module load (has a run export, so require() is attempted
// first) — simulates a missing dependency crashing the module, e.g. an absent ajv.
fs.writeFileSync(
  path.join(fixtureRoot, 'crash-on-require-hook.js'),
  "'use strict';\nthrow new Error('simulated missing dependency at load');\nfunction run() { return undefined; }\nmodule.exports = { run };\n"
);

// A hook whose run() throws when called (require succeeds, run() does not).
fs.writeFileSync(
  path.join(fixtureRoot, 'run-throw-hook.js'),
  "'use strict';\nfunction run() { throw new Error('simulated run failure'); }\nmodule.exports = { run };\n"
);

// A LEGACY hook (no run export → spawned as a child) that crashes at load.
fs.writeFileSync(
  path.join(fixtureRoot, 'legacy-crash-hook.js'),
  "'use strict';\nthrow new Error('legacy module load crash');\n"
);

// A LEGACY hook that cleanly BLOCKS (exit 2) — a legitimate verdict, not a crash.
fs.writeFileSync(
  path.join(fixtureRoot, 'legacy-block-hook.js'),
  "'use strict';\nprocess.stderr.write('legacy block reason\\n');\nprocess.exit(2);\n"
);

// A LEGACY hook that cleanly ALLOWS (echoes stdin, exit 0).
fs.writeFileSync(
  path.join(fixtureRoot, 'legacy-allow-hook.js'),
  "'use strict';\nconst fs=require('fs');\nlet raw='';try{raw=fs.readFileSync(0,'utf8');}catch(_){}\nprocess.stdout.write(raw);\nprocess.exit(0);\n"
);

process.on('exit', () => {
  try {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  } catch (_) {
    /* best-effort cleanup */
  }
});

function runRunner(args, input, env = {}) {
  return spawnSync('node', [runner, ...args], {
    input,
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: fixtureRoot, ...env },
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function oversizedPayload(maxStdin = DEFAULT_MAX_STDIN) {
  return JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/big.md', content: 'x'.repeat(maxStdin + 64 * 1024) },
  });
}

const NOOP = ['pre:test:noop', 'noop-hook.js', 'standard,strict'];

// --- Truncation / fail-open regression -------------------------------------

test('oversized payload exits 0 with empty stdout for an enabled hook', () => {
  const result = runRunner(NOOP, oversizedPayload());
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stdout, '', `stdout must be empty, got: ${result.stdout.slice(0, 120)}`);
  assert.match(result.stderr, /stdin exceeded \d+ bytes for pre:test:noop/);
  assert.match(result.stderr, /fail-open/);
});

test('oversized payload never echoes truncated stdin when hook args are missing', () => {
  const result = runRunner([], oversizedPayload());
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', 'missing-args path must not echo truncated stdin');
});

test('oversized payload never echoes truncated stdin for a disabled hook', () => {
  const result = runRunner(NOOP, oversizedPayload(), { ESCC_DISABLED_HOOKS: 'pre:test:noop' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', 'disabled-hook path must not echo truncated stdin');
});

test('a hook can still block on an oversized payload (no blanket skip)', () => {
  const result = runRunner(['pre:test:block', 'block-hook.js', 'standard,strict'], oversizedPayload());
  assert.strictEqual(result.status, 2, `expected block exit 2, got ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stdout, '', 'blocked truncated payload must not echo raw input');
});

// --- Pass-through correctness ----------------------------------------------

test('normal-sized payload passes through unchanged and stays valid JSON', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/small.js', content: 'const x = 1;\n' } });
  const result = runRunner(NOOP, payload);
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stdout, payload, 'pass-through must echo the payload unchanged');
  JSON.parse(result.stdout);
});

test('payload just under the cap echoes through completely (no 64KB pipe cut)', () => {
  const content = 'y'.repeat(DEFAULT_MAX_STDIN - 1024);
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/edge.md', content } });
  assert.ok(payload.length < DEFAULT_MAX_STDIN, 'fixture must stay under the stdin cap');
  const result = runRunner([], payload);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.length, payload.length, 'echo must not be cut at the pipe buffer');
  assert.strictEqual(result.stdout, payload);
});

test('disabled-hook passthrough of a >64KB payload stays valid JSON', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/medium.md', content: 'z'.repeat(256 * 1024) } });
  const result = runRunner(NOOP, payload, { ESCC_DISABLED_HOOKS: 'pre:test:noop' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, payload);
  JSON.parse(result.stdout);
});

// --- ESCC-specific: configurable cap ---------------------------------------

test('ESCC_HOOK_INPUT_MAX_BYTES lowers the stdin cap', () => {
  // Payload comfortably under the 1MB default but over the lowered cap.
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/x.md', content: 'q'.repeat(8 * 1024) } });
  assert.ok(payload.length < DEFAULT_MAX_STDIN && payload.length > 1024);
  const result = runRunner(NOOP, payload, { ESCC_HOOK_INPUT_MAX_BYTES: '1024' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', 'lowered cap must trip truncation suppression');
  assert.match(result.stderr, /stdin exceeded 1024 bytes/);
});

// --- Gating -----------------------------------------------------------------

test('profile gating skips a strict-only hook under the minimal profile', () => {
  // block-hook would exit 2 if it ran; under minimal profile it must be skipped
  // and the payload echoed through with exit 0 instead.
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/p.md', content: 'p' } });
  const result = runRunner(['pre:test:block', 'block-hook.js', 'strict'], payload, { ESCC_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(result.status, 0, 'minimal profile must skip a strict-only hook');
  assert.strictEqual(result.stdout, payload, 'skipped hook must pass the payload through');
});

// --- Security: path traversal ----------------------------------------------

test('path traversal outside the plugin root is rejected (fail-open echo)', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/t.md', content: 't' } });
  const result = runRunner(['pre:test:evil', '../../../../etc/passwd', 'standard,strict'], payload);
  assert.strictEqual(result.status, 0, 'traversal rejection must fail open');
  assert.strictEqual(result.stdout, payload, 'rejected hook still echoes the original payload');
  assert.match(result.stderr, /traversal/i);
});

// --- additionalContext is stamped with the ACTUAL firing event --------------
// Regression: the dispatcher hardcoded hookEventName:'PreToolUse' for every hook
// returning { additionalContext }, so a Stop (or PostToolUse) hook tripped Claude
// Code's "expected 'Stop' but got 'PreToolUse'" rejection.

function ctxInput(eventName) {
  return JSON.stringify({ hook_event_name: eventName, session_id: 's', transcript_path: '/no/tx.jsonl' });
}

test('Stop-hook additionalContext is NOT emitted as a PreToolUse hookSpecificOutput', () => {
  const result = runRunner(['stop:test:ctx', 'ctx-hook.js', 'standard,strict'], ctxInput('Stop'));
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.ok(!/hookSpecificOutput/.test(result.stdout), `Stop stdout must not carry hookSpecificOutput, got: ${result.stdout.slice(0, 120)}`);
  assert.ok(!/PreToolUse/.test(result.stdout), 'Stop output must not be stamped PreToolUse');
  assert.match(result.stderr, /confirm the drafts are sent/, 'the reminder still surfaces (via stderr)');
});

test('PostToolUse-hook additionalContext is stamped PostToolUse (not PreToolUse)', () => {
  const result = runRunner(['post:test:ctx', 'ctx-hook.js', 'standard,strict'], ctxInput('PostToolUse'));
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /confirm the drafts are sent/);
});

test('PreToolUse-hook additionalContext still stamps PreToolUse (no regression)', () => {
  const result = runRunner(['pre:test:ctx', 'ctx-hook.js', 'standard,strict'], ctxInput('PreToolUse'));
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /confirm the drafts are sent/);
});

// --- Fail-closed-on-crash: the send-gate must NEVER fail open ---------------
// CLAUDE.md §4: every hook fails open EXCEPT pre:outbound-send-gate, which fails
// CLOSED. If that hook cannot run to a verdict (module won't load, run() throws,
// or the legacy child crashes), the runner itself blocks (exit 2). These use the
// REAL fail-closed hookId with fixture scripts; the matching is on hookId, not the
// script. Belt-and-suspenders behind the optional-ajv runtime fix.

const GATE = 'pre:outbound-send-gate';
const gatePayload = JSON.stringify({ tool_name: 'mcp__claude_ai_Gmail__create_draft', tool_input: { to: 'x@y.com', body: 'hi' } });

test('fail-closed hook BLOCKS (exit 2) when its module fails to require', () => {
  const result = runRunner([GATE, 'crash-on-require-hook.js', 'minimal,standard,strict'], gatePayload);
  assert.strictEqual(result.status, 2, `expected block exit 2, got ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /BLOCKED \(fail-closed\)/);
  assert.strictEqual(result.stdout, '', 'a block must not echo the payload through');
});

test('fail-closed hook BLOCKS (exit 2) when run() throws', () => {
  const result = runRunner([GATE, 'run-throw-hook.js', 'minimal,standard,strict'], gatePayload);
  assert.strictEqual(result.status, 2, `expected block exit 2, got ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /BLOCKED \(fail-closed\)/);
});

test('fail-closed hook BLOCKS (exit 2) when the legacy child crashes', () => {
  const result = runRunner([GATE, 'legacy-crash-hook.js', 'minimal,standard,strict'], gatePayload);
  assert.strictEqual(result.status, 2, `expected block exit 2, got ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /BLOCKED \(fail-closed\)/);
});

test('fail-closed hook still PASSES a clean allow through (exit 0, payload echoed)', () => {
  const result = runRunner([GATE, 'noop-hook.js', 'minimal,standard,strict'], gatePayload);
  assert.strictEqual(result.status, 0, `expected allow exit 0, got ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stdout, gatePayload, 'a clean allow must pass the payload through');
});

test('fail-closed hook forwards a legacy clean allow (exit 0) without over-blocking', () => {
  const result = runRunner([GATE, 'legacy-allow-hook.js', 'minimal,standard,strict'], gatePayload);
  assert.strictEqual(result.status, 0, `expected allow exit 0, got ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stdout, gatePayload);
});

test('fail-closed hook forwards a legitimate legacy block (exit 2) unchanged', () => {
  const result = runRunner([GATE, 'legacy-block-hook.js', 'minimal,standard,strict'], gatePayload);
  assert.strictEqual(result.status, 2, `expected block exit 2, got ${result.status}: ${result.stderr}`);
  // It blocked because the hook decided to, not because the runner forced it.
  assert.match(result.stderr, /legacy block reason/);
});

test('a NON-fail-closed hook still fails OPEN on the same crash (does not block)', () => {
  const result = runRunner(['pre:test:noop', 'legacy-crash-hook.js', 'minimal,standard,strict'], gatePayload);
  assert.notStrictEqual(result.status, 2, 'a non-fail-closed crash must not block (fail-open)');
});
