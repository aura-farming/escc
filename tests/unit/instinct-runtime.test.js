'use strict';

/*
 * A.3 RUNTIME INTEGRATION tests — the seam that wires the (correct-in-isolation)
 * instinct engine into the live session hooks:
 *
 *   - session:start reads the ENGINE workspace store (instinct-store, rep-identity
 *     keyed) in addition to the shipped-seed dirs, applies the C6 segment filter
 *     to team-scoped instincts, honours a confidence floor, excludes
 *     human-rejected ids, and runs the I4 decay sweep BEFORE injecting.
 *   - session:end runs distill once per session, so captured observations actually
 *     become instincts — even when there is nothing else to summarise.
 *   - the full round-trip: observe -> (session:end) distill -> (session:start) inject.
 *
 * Hermetic: ESCC_INSTINCT_HOME keys the engine store at a tmpdir, ESCC_AGENT_DATA_HOME
 * keys the state store / account memory at another, and ESCC_REP_IDENTITY pins the
 * workspace — so nothing reads or writes the developer's real instinct store.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sessionStart = require('../../scripts/hooks/session-start');
const sessionEnd = require('../../scripts/hooks/session-end');
const store = require('../../scripts/instincts/instinct-store');
const accountMemory = require('../../scripts/lib/account-memory');

function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `escc-${tag}-`));
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

const now = () => new Date().toISOString();

/** Build a valid instinct; fresh timestamps unless overridden. */
function instinct(overrides = {}) {
  const ts = now();
  return {
    id: 'i1',
    trigger: 'when doing sales work',
    confidence: 0.85,
    domain: 'outreach',
    scope: 'personal',
    source: 'user_correction',
    created: ts,
    last_observed: ts,
    decay_exempt: false,
    action: 'do the thing',
    evidence: ['seen'],
    ...overrides,
  };
}

function startInput(source, sessionId) {
  return JSON.stringify({
    hook_event_name: 'SessionStart',
    source: source || 'startup',
    session_id: sessionId || 'sess-rt',
  });
}

function endInput(sessionId, transcriptPath) {
  const o = { hook_event_name: 'SessionEnd', session_id: sessionId || 'sess-rt' };
  if (transcriptPath) o.transcript_path = transcriptPath;
  return JSON.stringify(o);
}

function contextOf(result) {
  assert.ok(result && typeof result.stdout === 'string', 'session-start returns a stdout payload');
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

/** A hermetic env for one workspace: separate engine + data homes, pinned rep. */
function rtEnv(extra) {
  return {
    ESCC_INSTINCT_HOME: freshDir('rt-inst'),
    ESCC_AGENT_DATA_HOME: freshDir('rt-data'),
    ESCC_REP_IDENTITY: 'runtime-rep',
    ESCC_INSTINCTS_DIR: undefined,
    ESCC_ACTIVE_ACCOUNT: undefined,
    ...(extra || {}),
  };
}

// --- R1: engine personal instincts are injected -----------------------------

test('R1: session:start injects a high-confidence instinct from the engine workspace store', () => {
  withEnv(rtEnv(), () => {
    store.writeInstinct(instinct({
      id: 'lead-with-trigger',
      confidence: 0.85,
      action: 'Lead every cold email with a relevant trigger',
    }));
    const ctx = contextOf(sessionStart.run(startInput('startup')));
    assert.ok(/Active instincts/i.test(ctx), 'instincts block present');
    assert.ok(/relevant trigger/i.test(ctx), 'the engine-store instinct is injected');
  });
});

// --- R2: C6 segment filter on team instincts --------------------------------

test('R2: session:start applies the C6 segment filter to team-scoped instincts', () => {
  withEnv(rtEnv({ ESCC_ACTIVE_ACCOUNT: 'example-co' }), () => {
    accountMemory.appendEvent('example-co', { type: 'segment', segment: 'enterprise' });
    store.writeInstinct(instinct({
      id: 'multithread', scope: 'team', applies_to: 'enterprise', confidence: 0.85,
      action: 'Multithread into the enterprise buying committee early',
    }));
    store.writeInstinct(instinct({
      id: 'smb-short', scope: 'team', applies_to: 'smb', confidence: 0.85,
      action: 'Keep SMB outreach short',
    }));
    const ctx = contextOf(sessionStart.run(startInput('startup')));
    assert.ok(/buying committee/i.test(ctx), 'segment-matching team instinct injected');
    assert.ok(!/Keep SMB outreach short/i.test(ctx), 'non-matching segment team instinct filtered out');
  });
});

// --- R3: rejected ids are never injected (defense-in-depth) ------------------

test('R3: session:start excludes an instinct whose id is in the rejected registry', () => {
  withEnv(rtEnv(), () => {
    store.writeInstinct(instinct({ id: 'banned', confidence: 0.9, action: 'Do the banned thing' }));
    store.addIdToRegistry('rejected', 'banned'); // id rejected but file still present
    const ctx = contextOf(sessionStart.run(startInput('startup')));
    assert.ok(!/banned thing/i.test(ctx), 'a rejected instinct is not injected even above the floor');
  });
});

// --- R4: the I4 decay sweep runs at start -----------------------------------

test('R4: session:start runs the decay sweep and retires a stale low-confidence instinct', () => {
  withEnv(rtEnv(), () => {
    store.writeInstinct(instinct({
      id: 'stale-outreach', domain: 'outreach', confidence: 0.25,
      created: '2026-01-01T00:00:00.000Z', last_observed: '2026-01-01T00:00:00.000Z',
      action: 'a stale habit',
    }));
    const ctx = contextOf(sessionStart.run(startInput('startup')));
    const ids = store.readInstincts('personal').map(i => i.id);
    assert.ok(!ids.includes('stale-outreach'), 'the decay sweep retired the stale instinct at start');
    assert.ok(!/stale habit/i.test(ctx), 'a retired instinct is not injected');
  });
});

// --- R5: full round-trip observe -> session:end distill -> session:start -----

test('R5: an observation distilled at session end is injected at the next session start', () => {
  withEnv(rtEnv({ ESCC_INSTINCT_CONFIDENCE: '0.4' }), () => {
    store.appendObservation({
      kind: 'user_correction',
      text: 'always personalize the first line of a cold email',
      untrusted: false,
    });
    // Session ends — distill turns the observation into an instinct.
    sessionEnd.run(endInput('rt'));
    assert.ok(store.readInstincts('personal').length >= 1, 'session:end distilled the observation into an instinct');

    // The next session starts — the freshly learned instinct is injected.
    const ctx = contextOf(sessionStart.run(startInput('startup')));
    assert.ok(/personalize the first line/i.test(ctx), 'the distilled instinct round-trips into the next session');
  });
});

// --- R6: distill is decoupled from the summary path and fails open ----------

test('R6: session:end distills observations and fails open even on malformed input', () => {
  withEnv(rtEnv({ ESCC_INSTINCT_CONFIDENCE: '0.4' }), () => {
    store.appendObservation({
      kind: 'user_correction',
      text: 'send a recap email after every demo call',
      untrusted: false,
    });
    const result = sessionEnd.run('not json at all');
    assert.ok(result === undefined || (result && result.exitCode === 0), 'session:end fails open');
    assert.ok(
      store.readInstincts('personal').some(i => /recap/i.test(i.action || '')),
      'distill still ran despite unparseable input (not gated by the summary path)',
    );
  });
});

// --- R7/R8: the decay sweep covers team scope too (spec I8: team seeds are -----
// scope:team + decay_exempt, which is only meaningful if team scope is swept). --

test('R7: session:start decays and retires a stale, non-exempt team instinct', () => {
  withEnv(rtEnv(), () => {
    store.writeInstinct(instinct({
      id: 'stale-team', scope: 'team', domain: 'outreach', confidence: 0.25,
      decay_exempt: false, applies_to: '',
      created: '2026-01-01T00:00:00.000Z', last_observed: '2026-01-01T00:00:00.000Z',
      action: 'a stale team habit',
    }));
    sessionStart.run(startInput('startup'));
    const ids = store.readInstincts('team').map(i => i.id);
    assert.ok(!ids.includes('stale-team'), 'the decay sweep retires stale TEAM instincts, not just personal');
  });
});

test('R8: a decay_exempt team seed survives the sweep and is still injected', () => {
  withEnv(rtEnv(), () => {
    store.writeInstinct(instinct({
      id: 'seed-multithread', scope: 'team', domain: 'deals', confidence: 0.8,
      decay_exempt: true, applies_to: '',
      created: '2026-01-01T00:00:00.000Z', last_observed: '2026-01-01T00:00:00.000Z',
      action: 'Multithread into the buying committee before close',
    }));
    const ctx = contextOf(sessionStart.run(startInput('startup')));
    const ids = store.readInstincts('team').map(i => i.id);
    assert.ok(ids.includes('seed-multithread'), 'a decay_exempt team seed is never retired');
    assert.ok(/Multithread into the buying committee/i.test(ctx), 'the exempt team seed is still injected');
  });
});
