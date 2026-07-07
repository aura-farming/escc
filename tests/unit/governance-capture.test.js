'use strict';

/**
 * Tests for the ENV-GATED governance-capture hook.
 * Hermetic: each case points ESCC_AGENT_DATA_HOME at a fresh tmpdir so the
 * JSONL state store is isolated, and restores env afterward. Capture is gated
 * on ESCC_GOVERNANCE_CAPTURE=1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/governance-capture');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-govcap-'));
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

function input(toolName, toolInput, event) {
  return JSON.stringify({
    hook_event_name: event || 'PreToolUse',
    session_id: 'sess-1',
    tool_name: toolName,
    tool_input: toolInput || {},
  });
}

/** Read all governance_events rows from the isolated state store. */
function readEvents(home) {
  const fp = path.join(home, 'escc', 'state', 'governance_events.jsonl');
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch (_err) { return []; }
  return raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
}

test('returns undefined and records NOTHING when capture is disabled (default off)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome(), ESCC_GOVERNANCE_CAPTURE: undefined }, () => {
    const result = hook.run(input('Bash', { command: 'rm -rf /tmp/x' }));
    assert.equal(result, undefined);
  });
});

test('records secret_detected for a hardcoded secret in tool input', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    hook.run(input('Write', { file_path: 'a.js', content: 'const token = "abcd1234efgh5678"' }));
    const events = readEvents(home);
    assert.ok(events.some(e => e.event_type === 'secret_detected'), 'expected secret_detected');
  });
});

test('records approval_requested for a destructive shell command', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    hook.run(input('Bash', { command: 'git push origin main --force' }));
    const events = readEvents(home);
    assert.ok(events.some(e => e.event_type === 'approval_requested'));
  });
});

test('records policy_violation for a write to a sensitive path', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    hook.run(input('Write', { file_path: '/repo/.env', content: 'X=1' }));
    const events = readEvents(home);
    assert.ok(events.some(e => e.event_type === 'policy_violation'));
  });
});

test('records bulk_send_attempt for a send tool over the recipient threshold', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    const recipients = ['a@x.example', 'b@x.example', 'c@x.example', 'd@x.example', 'e@x.example', 'f@x.example'];
    hook.run(input('mcp__test__send_email', { to: recipients }));
    const events = readEvents(home);
    assert.ok(events.some(e => e.event_type === 'bulk_send_attempt'));
  });
});

test('records unapproved_send for a live send issued through Bash', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    hook.run(input('Bash', { command: 'curl -X POST https://api.example.com/v1/messages/send -d @body.json' }));
    const events = readEvents(home);
    assert.ok(events.some(e => e.event_type === 'unapproved_send'));
  });
});

test('records crm_destructive_op for a CRM delete in the tool input', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    hook.run(input('mcp__hubspot__manage_crm_objects', { operation: 'delete', objectType: 'deal', objectId: '123' }));
    const events = readEvents(home);
    assert.ok(events.some(e => e.event_type === 'crm_destructive_op'));
  });
});

test('records hook_input_truncated and never blocks on a truncated payload', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    const result = hook.run(input('Write', { file_path: 'a.js' }), { truncated: true });
    assert.equal(result, undefined, 'truncated payload must not block (capture hook)');
    const events = readEvents(home);
    assert.ok(events.some(e => e.event_type === 'hook_input_truncated'));
  });
});

test('rows carry the exact governance_events snake_case shape', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    hook.run(input('Bash', { command: 'rm -rf /tmp/x' }));
    const [row] = readEvents(home);
    assert.ok(row && typeof row.id === 'string');
    assert.equal(row.session_id, 'sess-1');
    assert.ok(typeof row.event_type === 'string');
    assert.ok('payload' in row);
    assert.equal(row.resolved_at, null);
    assert.equal(row.resolution, null);
    assert.ok(typeof row.created_at === 'string');
  });
});

test('clean input records nothing and returns undefined', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    const result = hook.run(input('Read', { file_path: 'README.md' }));
    assert.equal(result, undefined);
    assert.equal(readEvents(home).length, 0);
  });
});

test('returns additionalContext (never blocks) when events are captured', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_GOVERNANCE_CAPTURE: '1' }, () => {
    const result = hook.run(input('Bash', { command: 'git reset --hard HEAD~1' }));
    assert.ok(result && typeof result.additionalContext === 'string');
    assert.ok(!('exitCode' in result) || result.exitCode !== 2, 'capture hook never blocks');
  });
});
