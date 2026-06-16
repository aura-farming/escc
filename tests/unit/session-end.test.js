'use strict';

/*
 * Tests for the session-end hook (A.2 C1 + C3):
 *  - transcript JSONL -> markdown session summary (paired markers)
 *  - appends tagged events to the ACTIVE account's memory (C1)
 *  - persists detected promises to the state-store `promises` table (C3)
 * Hermetic: ESCC_AGENT_DATA_HOME -> fresh tmpdir; transcript written to tmp.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/session-end');
const accountMemory = require('../../scripts/lib/account-memory');
const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-sessionend-'));
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

/** Write a synthetic Claude Code transcript JSONL and return its path. */
function writeTranscript(home, sessionId, lines) {
  const dir = path.join(home, 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
  return fp;
}

/** Seed the per-session activity file (accounts touched) that session-end reads. */
function seedActivity(home, sessionId, accounts) {
  const dir = path.join(home, 'metrics', 'activity');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify({ session_id: sessionId, accounts, files: [], tools: {}, tool_calls: 0 }),
    'utf8'
  );
}

const TRANSCRIPT_LINES = [
  { type: 'user', message: { role: 'user', content: 'Prep outreach for Acme and follow up on the deal.' } },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: "I drafted the email. I'll send the proposal by 2026-06-20." },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/outbound/acme.md' } },
      ],
    },
  },
];

function endInput(sessionId, transcriptPath) {
  return JSON.stringify({
    hook_event_name: 'SessionEnd',
    session_id: sessionId,
    transcript_path: transcriptPath,
  });
}

test('writes a markdown session summary with paired markers', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    const tp = writeTranscript(home, 'sess-end-1', TRANSCRIPT_LINES);
    seedActivity(home, 'sess-end-1', ['company:acme', 'deal:deal-1', 'domain:acme.io']);
    hook.run(endInput('sess-end-1', tp));

    const sessionDir = path.join(home, 'session-data');
    const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('-session.tmp'));
    assert.ok(files.length >= 1, 'a session-data summary file was written');
    const content = fs.readFileSync(path.join(sessionDir, files[0]), 'utf8');
    assert.ok(content.includes('ESCC:SUMMARY:START'), 'summary uses paired start marker');
    assert.ok(content.includes('ESCC:SUMMARY:END'), 'summary uses paired end marker');
  });
});

test('appends tagged events to the active account memory (C1)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    const tp = writeTranscript(home, 'sess-end-2', TRANSCRIPT_LINES);
    seedActivity(home, 'sess-end-2', ['company:acme', 'deal:deal-1']);
    hook.run(endInput('sess-end-2', tp));

    const events = accountMemory.readEvents('company:acme');
    assert.ok(events.length >= 1, 'account memory received at least one event');
    assert.ok(events.some(e => e.type === 'session_summary'), 'a session_summary event was appended');
  });
});

test('persists detected promises to the state-store promises table (C3)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    const tp = writeTranscript(home, 'sess-end-3', TRANSCRIPT_LINES);
    seedActivity(home, 'sess-end-3', ['company:acme', 'deal:deal-1']);
    hook.run(endInput('sess-end-3', tp));

    const store = createStateStoreSync();
    try {
      const open = store.listOpenPromises();
      assert.ok(open.length >= 1, 'at least one promise persisted');
      const proposal = open.find(p => /proposal/i.test(p.text));
      assert.ok(proposal, 'the "send the proposal" promise was captured');
      assert.equal(proposal.due_date, '2026-06-20', 'ISO due date captured');
      assert.equal(proposal.source_session, 'sess-end-3');
    } finally {
      store.close();
    }
  });
});

test('repeated SessionEnd runs are idempotent for promises (stable id upsert)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    const tp = writeTranscript(home, 'sess-end-4', TRANSCRIPT_LINES);
    seedActivity(home, 'sess-end-4', ['company:acme']);
    hook.run(endInput('sess-end-4', tp));
    hook.run(endInput('sess-end-4', tp));

    const store = createStateStoreSync();
    try {
      const proposals = store.listOpenPromises().filter(p => /proposal/i.test(p.text));
      assert.equal(proposals.length, 1, 'the same promise is not duplicated across runs');
    } finally {
      store.close();
    }
  });
});

test('never blocks — fails open on a missing transcript', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home }, () => {
    const result = hook.run(endInput('sess-none', '/no/such/transcript.jsonl'));
    assert.ok(result === undefined || (result && result.exitCode === 0));
    assert.ok(!result || result.exitCode !== 2, 'session-end must never block');
  });
});
