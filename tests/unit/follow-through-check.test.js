'use strict';

/*
 * Tests for the stop:follow-through-check hook (A.2 C3): WARN-ONLY surfacing of
 * ALL open promises (overdue flagged) plus this-session follow-through gaps
 * (promised-but-unlogged follow-ups, unsent drafts). Never blocks. Hermetic.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/follow-through-check');
const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-followthrough-'));
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

function stopInput(sessionId, transcriptPath) {
  return JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcriptPath });
}

test('surfaces all open promises and flags overdue ones (warn-only)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const store = createStateStoreSync();
    try {
      store.upsertPromise({ id: 'p-overdue', account_id: 'example-co', text: 'Send the overdue quote', due_date: '2020-01-01' });
      store.upsertPromise({ id: 'p-open', account_id: 'sample-co', text: 'Schedule the demo', due_date: '2099-01-01' });
    } finally {
      store.close();
    }
    const result = hook.run(stopInput('s1', '/no/transcript.jsonl'));
    assert.ok(result && typeof result.additionalContext === 'string', 'returns a warn-only context');
    assert.ok(/open promise/i.test(result.additionalContext));
    assert.ok(/overdue/i.test(result.additionalContext));
    assert.ok(result.exitCode !== 2, 'never blocks');
  });
});

test('warns when more follow-ups were promised than logged this session', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const tp = writeTranscript(home, [
      { type: 'user', message: { role: 'user', content: 'Work the Example Co thread.' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: "I'll follow up tomorrow. I'll send the deck after." }] } },
    ]);
    const result = hook.run(stopInput('s2', tp));
    assert.ok(result && /follow-?up/i.test(result.additionalContext), 'flags the follow-through gap');
  });
});

test('stays silent when there is nothing to surface', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const result = hook.run(stopInput('s3', '/no/transcript.jsonl'));
    assert.equal(result, undefined);
  });
});

test('never blocks — fails open on internal error', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: '/dev/null/nope' }, () => {
    const result = hook.run(stopInput('s4', '/no/transcript.jsonl'));
    assert.ok(result === undefined || (result && result.exitCode === 0));
    assert.ok(!result || result.exitCode !== 2);
  });
});
