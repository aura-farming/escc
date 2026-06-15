'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/evaluate-session');

// --- helpers -------------------------------------------------------------

/** Build a JSONL transcript: `userCount` user turns + the given extra text lines. */
function writeTranscript(dir, userCount, extraLines) {
  const lines = [];
  for (let i = 0; i < userCount; i += 1) {
    lines.push(JSON.stringify({ type: 'user', message: { content: `msg ${i}` } }));
  }
  for (const text of extraLines || []) {
    lines.push(JSON.stringify({ type: 'assistant', message: { content: text } }));
  }
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function stopInput(transcriptPath, sessionId) {
  return JSON.stringify({
    hook_event_name: 'Stop',
    session_id: sessionId || 'sess-eval',
    transcript_path: transcriptPath,
  });
}

/** Run `fn` with ESCC_AGENT_DATA_HOME pointed at a fresh tmpdir; restore after. */
function withTmpHome(fn) {
  const prevHome = process.env.ESCC_AGENT_DATA_HOME;
  const prevMin = process.env.ESCC_MIN_SESSION_LENGTH;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-eval-'));
  process.env.ESCC_AGENT_DATA_HOME = tmp;
  try {
    return fn(tmp);
  } finally {
    if (prevHome === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prevHome;
    if (prevMin === undefined) delete process.env.ESCC_MIN_SESSION_LENGTH;
    else process.env.ESCC_MIN_SESSION_LENGTH = prevMin;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
}

function readObservations(home) {
  const file = path.join(home, 'escc', 'observations', 'session-outcomes.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- tests ---------------------------------------------------------------

test('stays silent for a short session (below threshold)', () => {
  withTmpHome((home) => {
    const tp = writeTranscript(home, 3, []);
    const result = hook.run(stopInput(tp));
    assert.equal(result, undefined);
    assert.equal(readObservations(home).length, 0, 'no observation written for a short session');
  });
});

test('records an observation and summarizes a substantial session', () => {
  withTmpHome((home) => {
    const tp = writeTranscript(home, 12, []);
    const result = hook.run(stopInput(tp));
    assert.ok(result && typeof result.additionalContext === 'string');
    assert.match(result.additionalContext, /12 user messages/);
    const rows = readObservations(home);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message_count, 12);
    assert.equal(rows[0].evaluate_for_patterns, true);
  });
});

test('derives sales metrics from the transcript and surfaces them', () => {
  withTmpHome((home) => {
    const tp = writeTranscript(home, 11, [
      'Calling create_draft to email the prospect',
      'Used create_event to book the demo',
      'Fetched the Fireflies transcript for review',
    ]);
    const result = hook.run(stopInput(tp));
    assert.ok(result && result.additionalContext);
    assert.match(result.additionalContext, /Sales activity this session/i);
    const metrics = readObservations(home)[0].metrics;
    assert.equal(metrics.draftsCreated, 1);
    assert.equal(metrics.meetingsBooked, 1);
    assert.equal(metrics.transcriptsFetched, 1);
  });
});

test('honors ESCC_MIN_SESSION_LENGTH override', () => {
  withTmpHome((home) => {
    process.env.ESCC_MIN_SESSION_LENGTH = '5';
    const tp = writeTranscript(home, 6, []);
    const result = hook.run(stopInput(tp));
    assert.ok(result && result.additionalContext, 'session counts as substantial under the lower threshold');
  });
});

test('returns undefined when there is no transcript', () => {
  withTmpHome(() => {
    const result = hook.run(stopInput('/nonexistent/path/transcript.jsonl'));
    assert.equal(result, undefined);
  });
});

test('falls back to regex user-count when lines are not clean JSON', () => {
  withTmpHome((home) => {
    const file = path.join(home, 'legacy.txt');
    // Non-JSON lines, but ECC-style "type":"user" markers present 11 times.
    const body = Array.from({ length: 11 }, () => 'noise "type":"user" noise').join('\n');
    fs.writeFileSync(file, body, 'utf8');
    const result = hook.run(stopInput(file));
    assert.ok(result && result.additionalContext);
    assert.match(result.additionalContext, /11 user messages/);
  });
});

test('fails open (no throw) on malformed raw input', () => {
  withTmpHome(() => {
    const result = hook.run('not json at all');
    assert.equal(result, undefined, 'no transcript resolvable → undefined, never throws');
  });
});
