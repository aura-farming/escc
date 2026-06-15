'use strict';

/*
 * Unit tests for scripts/hooks/cost-tracker.js (stop:cost-tracker).
 *
 * Hermetic: ESCC_AGENT_DATA_HOME points at a fresh os.tmpdir() directory so the
 * costs.jsonl row is written under a throwaway metrics dir. A throwaway
 * transcript JSONL is written and fed via transcript_path. Each test cleans up
 * its temp dir. Per Amendment A.4 there is no harness-cost cache file — cost is
 * always the transcript-sum estimate (RATE_TABLE).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/cost-tracker.js');

function withTempDataHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-cost-'));
  const savedHome = Object.prototype.hasOwnProperty.call(process.env, 'ESCC_AGENT_DATA_HOME')
    ? process.env.ESCC_AGENT_DATA_HOME : undefined;
  process.env.ESCC_AGENT_DATA_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (savedHome === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = savedHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeTranscript(dir, lines) {
  const fp = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return fp;
}

function readRows(dir) {
  const fp = path.join(dir, 'metrics', 'costs.jsonl');
  const raw = fs.readFileSync(fp, 'utf8');
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const ASSISTANT_TURN = (model, usage) => ({ type: 'assistant', message: { model, usage } });

test('run appends one row with ECC exact field set, summing transcript usage', () => {
  withTempDataHome((dir) => {
    const transcriptPath = writeTranscript(dir, [
      ASSISTANT_TURN('claude-sonnet-4-6', {
        input_tokens: 100, output_tokens: 50,
        cache_creation_input_tokens: 10, cache_read_input_tokens: 5,
      }),
      ASSISTANT_TURN('claude-sonnet-4-6', {
        input_tokens: 200, output_tokens: 80,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 20,
      }),
      { type: 'user', message: { content: 'ignored' } },
    ]);

    const result = hook.run(JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'sess-abc',
      transcript_path: transcriptPath,
    }));
    assert.ok(result && result.exitCode === 0, 'cost-tracker is non-blocking (exit 0)');

    const rows = readRows(dir);
    assert.equal(rows.length, 1, 'exactly one row appended');
    const row = rows[0];

    // Exact field set (and no extras).
    assert.deepEqual(
      Object.keys(row).sort(),
      ['cache_creation_input_tokens', 'cache_read_input_tokens', 'cost_usd',
        'input_tokens', 'model', 'output_tokens', 'session_id', 'ts'].sort()
    );

    assert.equal(row.session_id, 'sess-abc');
    assert.equal(row.model, 'claude-sonnet-4-6');
    assert.equal(row.input_tokens, 300);
    assert.equal(row.output_tokens, 130);
    assert.equal(row.cache_creation_input_tokens, 10);
    assert.equal(row.cache_read_input_tokens, 25);
    assert.ok(typeof row.ts === 'string' && row.ts.length > 0);
    assert.ok(typeof row.cost_usd === 'number' && row.cost_usd > 0);
  });
});

test('run computes cost from the transcript via RATE_TABLE (no harness-cost file)', () => {
  withTempDataHome((dir) => {
    const transcriptPath = writeTranscript(dir, [
      ASSISTANT_TURN('claude-opus-4-8', {
        input_tokens: 1000, output_tokens: 500,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      }),
    ]);
    const result = hook.run(JSON.stringify({
      session_id: 'opus-sess', transcript_path: transcriptPath,
    }));
    assert.ok(result && result.exitCode === 0);
    const row = readRows(dir)[0];
    // opus rates: in 15, out 75 per 1M → 1000/1e6*15 + 500/1e6*75 = 0.0525
    assert.equal(row.cost_usd, 0.0525, 'cost is the transcript-sum estimate');
    assert.equal(row.model, 'claude-opus-4-8');
  });
});

test('run fails open (exit 0, no row) when transcript path is absent', () => {
  withTempDataHome((dir) => {
    const result = hook.run(JSON.stringify({ session_id: 'no-transcript' }));
    assert.ok(result && result.exitCode === 0);
    const row = readRows(dir)[0];
    // Zero-usage row still written; model unknown; cost 0.
    assert.equal(row.session_id, 'no-transcript');
    assert.equal(row.model, 'unknown');
    assert.equal(row.input_tokens, 0);
    assert.equal(row.cost_usd, 0);
  });
});

test('run never throws on malformed input (fail open)', () => {
  withTempDataHome(() => {
    const result = hook.run('not json at all {{{');
    assert.ok(result && result.exitCode === 0);
  });
});

test('sumUsageFromTranscript returns null on an unreadable path', () => {
  assert.equal(hook.sumUsageFromTranscript('/no/such/transcript/file.jsonl'), null);
});

test('getRates picks opus/haiku/sonnet by model substring', () => {
  assert.equal(hook.getRates('claude-opus-4-8').out, 75.0);
  assert.equal(hook.getRates('claude-haiku-4-5').out, 4.0);
  assert.equal(hook.getRates('claude-sonnet-4-6').out, 15.0);
  assert.equal(hook.getRates('unknown').out, 15.0, 'defaults to sonnet rates');
});
