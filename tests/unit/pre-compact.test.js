'use strict';

/*
 * Tests for the pre:compact hook (A.2 C4): before context compaction, persist a
 * resumable scratch file (task intent, active account/deal, pending actions,
 * findings, pending tool actions) so the post-compaction SessionStart can resume
 * from it. Hermetic: ESCC_AGENT_DATA_HOME -> fresh tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/pre-compact');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-precompact-'));
}

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

function writeTranscript(home, lines) {
  const dir = path.join(home, 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'tx.jsonl');
  fs.writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
  return fp;
}

const LINES = [
  { type: 'user', message: { role: 'user', content: 'Build the close plan for the Acme deal.' } },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Next step: get legal to review the MSA. Still need pricing sign-off.' },
        { type: 'tool_use', name: 'mcp__hubspot__search_crm_objects', input: {} },
      ],
    },
  },
];

function compactInput(sessionId, transcriptPath, trigger) {
  return JSON.stringify({
    hook_event_name: 'PreCompact',
    session_id: sessionId,
    transcript_path: transcriptPath,
    trigger: trigger || 'auto',
  });
}

test('writes a resumable scratch file with task intent and pending actions', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: 'acme' }, () => {
    const tp = writeTranscript(home, LINES);
    hook.run(compactInput('sess-pc-1', tp));

    const state = hook.readCompactionState('sess-pc-1');
    assert.ok(state, 'scratch file is readable');
    assert.ok(/close plan/i.test(state.task_intent), 'task intent captured from last user message');
    assert.ok(state.pending_actions.some(a => /legal|MSA|pricing/i.test(a)), 'pending actions captured');
    assert.equal(state.active_account, 'acme', 'active account recorded');
    assert.equal(state.trigger, 'auto');
  });
});

test('scratch file lives under escc/compaction keyed by session id', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    const tp = writeTranscript(home, LINES);
    hook.run(compactInput('sess-pc-2', tp));
    const fp = path.join(home, 'escc', 'compaction', 'sess-pc-2.json');
    assert.ok(fs.existsSync(fp), 'scratch file at the expected path');
  });
});

test('never blocks — fails open on a missing transcript', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const result = hook.run(compactInput('sess-pc-3', '/no/such.jsonl'));
    assert.ok(result === undefined || (result && result.exitCode === 0));
    assert.ok(!result || result.exitCode !== 2, 'pre:compact must never block');
  });
});

test('readCompactionState returns null for an unknown session', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    assert.equal(hook.readCompactionState('never'), null);
  });
});
