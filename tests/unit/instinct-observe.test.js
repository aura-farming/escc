'use strict';

/*
 * Tests for the A.3 instinct OBSERVE path (Pass 1b):
 *   - scripts/instincts/observe.js     — pure trust + observation-shape logic
 *   - scripts/hooks/observe-runner.js  — the wired pre:/post:observe hook
 *
 * I3 (untrusted-content guard, capture side): observations from tools whose
 * OUTPUT carries external / prospect-authored content are tagged untrusted:true
 * so the distill step can refuse to derive instincts from them. The hook is
 * pass-through (never blocks, never adds context) and fails open. Hermetic:
 * ESCC_INSTINCT_HOME points the store at a tmpdir; ESCC_REP_IDENTITY keys it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const observe = require('../../scripts/instincts/observe');
const runner = require('../../scripts/hooks/observe-runner');
const store = require('../../scripts/instincts/instinct-store');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-observe-'));
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

test('isUntrustedTool flags external-content tools and clears the rep\'s own tools (I3)', () => {
  assert.ok(observe.isUntrustedTool('WebFetch'), 'WebFetch is untrusted');
  assert.ok(observe.isUntrustedTool('WebSearch'), 'WebSearch is untrusted');
  assert.ok(observe.isUntrustedTool('mcp__claude_ai_Gmail__get_thread'), 'Gmail read is untrusted');
  assert.ok(observe.isUntrustedTool('mcp__claude_ai_Gmail__search_threads'), 'Gmail search is untrusted');
  assert.ok(observe.isUntrustedTool('mcp__claude_ai_Fireflies__get_transcript'), 'call transcripts are untrusted');
  assert.ok(observe.isUntrustedTool('mcp__exa__search'), 'exa search is untrusted');
  assert.ok(observe.isUntrustedTool('mcp__firecrawl__scrape'), 'firecrawl is untrusted');
  assert.ok(observe.isUntrustedTool('mcp__plugin_ecc_chrome-devtools__take_snapshot'), 'page snapshot is untrusted');

  assert.ok(!observe.isUntrustedTool('Edit'), 'Edit is the rep\'s own action');
  assert.ok(!observe.isUntrustedTool('Read'), 'Read is trusted by default');
  assert.ok(!observe.isUntrustedTool('Bash'), 'Bash is trusted');
  assert.ok(!observe.isUntrustedTool('mcp__hubspot__manage_crm_objects'), 'CRM is the rep\'s system of record');
  assert.ok(!observe.isUntrustedTool('mcp__claude_ai_Gmail__create_draft'), 'composing a draft is the rep\'s own content');
  assert.ok(!observe.isUntrustedTool(''), 'empty tool name is not untrusted');
});

test('buildObservation records a trusted pre tool_use observation', () => {
  const obs = observe.buildObservation(
    JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', session_id: 's1' }),
    { event: 'pre' },
  );
  assert.equal(obs.kind, 'tool_use');
  assert.equal(obs.event, 'pre');
  assert.equal(obs.tool, 'Edit');
  assert.equal(obs.session_id, 's1');
  assert.equal(obs.untrusted, false);
  assert.equal(obs.error, undefined, 'no error flag on a pre observation');
});

test('buildObservation tags untrusted output tools untrusted:true (I3)', () => {
  const obs = observe.buildObservation(
    JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'WebFetch', session_id: 's1', tool_response: {} }),
    { event: 'post' },
  );
  assert.equal(obs.untrusted, true);
  assert.equal(obs.event, 'post');
});

test('buildObservation flags an errored post tool call (error-resolution signal)', () => {
  const errored = observe.buildObservation(
    JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { is_error: true } }),
    { event: 'post' },
  );
  assert.equal(errored.error, true);
  const ok = observe.buildObservation(
    JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'done' } }),
    { event: 'post' },
  );
  assert.equal(ok.error, false);
});

test('buildObservation returns null when there is no tool (lifecycle events, junk)', () => {
  assert.equal(observe.buildObservation(JSON.stringify({ hook_event_name: 'SessionStart' })), null);
  assert.equal(observe.buildObservation('not json at all'), null);
  assert.equal(observe.buildObservation(''), null);
});

test('observe-runner.run appends a tool_use observation and passes through (returns undefined)', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-obs' }, () => {
    const out = runner.run(
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', session_id: 's9' }),
      { hookId: 'post:observe' },
    );
    assert.equal(out, undefined, 'pass-through hook returns undefined');
    const rows = store.readObservations();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool, 'Edit');
    assert.equal(rows[0].event, 'post');
    assert.equal(rows[0].untrusted, false);
    assert.ok(rows[0].id && rows[0].ts, 'store fills id + ts');
  });
});

test('observe-runner derives the event from the dispatcher hookId and tags untrusted tools', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-obs2' }, () => {
    runner.run(JSON.stringify({ tool_name: 'WebFetch' }), { hookId: 'pre:observe' });
    const rows = store.readObservations();
    assert.equal(rows[0].event, 'pre', 'pre:observe -> event pre');
    assert.equal(rows[0].untrusted, true, 'WebFetch tagged untrusted even with no hook_event_name');
  });
});

test('observe-runner records nothing when there is no tool name', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-obs3' }, () => {
    const out = runner.run(JSON.stringify({ hook_event_name: 'SessionStart' }), { hookId: 'pre:observe' });
    assert.equal(out, undefined);
    assert.equal(store.readObservations().length, 0);
  });
});

test('observe-runner fails open on malformed input (no throw, nothing recorded)', () => {
  const home = freshHome();
  withEnv({ ESCC_INSTINCT_HOME: home, ESCC_REP_IDENTITY: 'rep-obs4' }, () => {
    let out;
    assert.doesNotThrow(() => { out = runner.run('{bad json', { hookId: 'post:observe' }); });
    assert.equal(out, undefined);
    assert.equal(store.readObservations().length, 0);
  });
});
