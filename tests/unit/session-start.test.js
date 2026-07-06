'use strict';

/*
 * Tests for the session:start hook — the A.2 priority-budgeted context injection:
 *  C4 resume-from-compaction, C2/C3 overdue + open promises (decoupled from the
 *  7-day gate), C1 active-account hydration, recent-summary welcome-back, and
 *  C6 instincts filtered by the active account's segment, all capped by
 *  ESCC_SESSION_START_MAX_CHARS (C7). Hermetic: fresh tmpdir data home.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/session-start');
const preCompact = require('../../scripts/hooks/pre-compact');
const accountMemory = require('../../scripts/lib/account-memory');
const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-sessionstart-'));
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

function startInput(source, sessionId) {
  return JSON.stringify({
    hook_event_name: 'SessionStart',
    source: source || 'startup',
    session_id: sessionId || 'sess-start-1',
  });
}

/** Parse the SessionStart payload the hook returns and return its additionalContext. */
function contextOf(result) {
  assert.ok(result && typeof result.stdout === 'string', 'hook returns a stdout payload');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart', 'SessionStart-shaped payload');
  return parsed.hookSpecificOutput.additionalContext;
}

function seedOverduePromise(text) {
  const store = createStateStoreSync();
  try {
    store.upsertPromise({ id: `p-${text.length}`, account_id: 'acme', deal_id: 'deal-1', text, due_date: '2020-01-01' });
  } finally {
    store.close();
  }
}

test('returns a SessionStart-shaped payload even with no data', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_INSTINCTS_DIR: undefined }, () => {
    const ctx = contextOf(hook.run(startInput('startup')));
    assert.equal(typeof ctx, 'string');
  });
});

test('injects overdue promises ahead of everything (C2/C3)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_INSTINCTS_DIR: undefined }, () => {
    seedOverduePromise('Send Acme the renewal quote');
    const ctx = contextOf(hook.run(startInput('startup')));
    assert.ok(/overdue/i.test(ctx), 'overdue section present');
    assert.ok(/renewal quote/i.test(ctx), 'the overdue promise text is surfaced');
  });
});

test('resume-from-compaction block is injected when a scratch file exists (C4)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: 'acme', ESCC_INSTINCTS_DIR: undefined }, () => {
    // Build a compaction scratch via the pre:compact hook's own writer.
    const tdir = path.join(home, 'transcripts');
    fs.mkdirSync(tdir, { recursive: true });
    const tp = path.join(tdir, 'tx.jsonl');
    fs.writeFileSync(tp, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Finish the Acme close plan.' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Next step: get pricing sign-off.' }] } }),
    ].join('\n'));
    preCompact.run(JSON.stringify({ hook_event_name: 'PreCompact', session_id: 'sess-resume', transcript_path: tp, trigger: 'auto' }));

    const ctx = contextOf(hook.run(startInput('compact', 'sess-resume')));
    assert.ok(/compaction/i.test(ctx), 'resume block labels the compaction');
    assert.ok(/close plan/i.test(ctx), 'task intent restored');
    assert.ok(/pricing sign-off/i.test(ctx), 'pending action restored');
  });
});

test('hydrates the active account context (C1)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: 'globex', ESCC_INSTINCTS_DIR: undefined }, () => {
    accountMemory.appendEvent('globex', { type: 'note', text: 'Champion is the VP of RevOps', segment: 'enterprise' });
    const ctx = contextOf(hook.run(startInput('startup')));
    assert.ok(/globex/i.test(ctx), 'active account named');
    assert.ok(/VP of RevOps/i.test(ctx), 'active account memory hydrated into context');
  });
});

test('surfaces a recent summary with a welcome-back note after a >7-day gap (C2)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_INSTINCTS_DIR: undefined }, () => {
    const dir = path.join(home, 'session-data');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, '2026-05-01-old-session.tmp');
    fs.writeFileSync(fp, '# Session\n**Worktree:** ' + process.cwd() + '\n---\n<!-- ESCC:SUMMARY:START -->\nWorked the Initech deal.\n<!-- ESCC:SUMMARY:END -->\n');
    const old = Date.now() - 20 * 24 * 60 * 60 * 1000;
    fs.utimesSync(fp, new Date(old), new Date(old));

    const ctx = contextOf(hook.run(startInput('startup')));
    assert.ok(/welcome back|been \d+ day/i.test(ctx), 'welcome-back digest after a gap');
    assert.ok(/HISTORICAL REFERENCE ONLY/i.test(ctx), 'prior summary wrapped in the stale-replay guard');
  });
});

test('injects instincts filtered by the active account segment (C6)', () => {
  const home = freshHome();
  const instDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-inst-'));
  fs.writeFileSync(path.join(instDir, 'a.md'), '---\nid: speed-to-lead\nconfidence: 0.9\napplies_to: enterprise\n---\n## Action\nRespond to enterprise inbound within SLA.\n');
  fs.writeFileSync(path.join(instDir, 'b.md'), '---\nid: smb-only\nconfidence: 0.9\napplies_to: smb\n---\n## Action\nKeep SMB cadence short.\n');
  fs.writeFileSync(path.join(instDir, 'c.md'), '---\nid: draft-before-send\nconfidence: 0.9\n---\n## Action\nAlways draft before sending.\n');

  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: 'acme', ESCC_INSTINCTS_DIR: instDir }, () => {
    accountMemory.appendEvent('acme', { type: 'segment', segment: 'enterprise' });
    const ctx = contextOf(hook.run(startInput('startup')));
    assert.ok(/enterprise inbound within SLA/i.test(ctx), 'segment-matching instinct injected');
    assert.ok(/draft before sending/i.test(ctx), 'generic (no applies_to) instinct injected');
    assert.ok(!/SMB cadence short/i.test(ctx), 'non-matching segment instinct filtered out');
  });
});

test('respects ESCC_SESSION_START_CONTEXT=off (empty context)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_SESSION_START_CONTEXT: 'off', ESCC_INSTINCTS_DIR: undefined }, () => {
    seedOverduePromise('should not appear');
    const ctx = contextOf(hook.run(startInput('startup')));
    assert.equal(ctx, '', 'context injection disabled');
  });
});

test('respects the ESCC_SESSION_START_MAX_CHARS budget (C7)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_SESSION_START_MAX_CHARS: '120', ESCC_INSTINCTS_DIR: undefined }, () => {
    for (let i = 0; i < 10; i++) seedOverduePromise(`Overdue commitment number ${i} with a fair bit of text to consume budget`);
    const ctx = contextOf(hook.run(startInput('startup')));
    assert.ok(ctx.length <= 120, `context within budget (was ${ctx.length})`);
    assert.ok(/overdue/i.test(ctx), 'highest-priority category survives truncation');
  });
});

test('never blocks — malformed input still yields a valid SessionStart payload', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home }, () => {
    const ctx = contextOf(hook.run('not json at all'));
    assert.equal(typeof ctx, 'string');
  });
});

test('resume block is one-shot — not re-injected on a second SessionStart (C4)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_INSTINCTS_DIR: undefined }, () => {
    const tdir = path.join(home, 'transcripts');
    fs.mkdirSync(tdir, { recursive: true });
    const tp = path.join(tdir, 'tx.jsonl');
    fs.writeFileSync(tp, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Finish the Acme close plan.' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Next step: pricing sign-off.' }] } }),
    ].join('\n'));
    preCompact.run(JSON.stringify({ hook_event_name: 'PreCompact', session_id: 'one-shot', transcript_path: tp, trigger: 'auto' }));

    const first = contextOf(hook.run(startInput('compact', 'one-shot')));
    assert.ok(/compaction/i.test(first), 'resume block present on first start');
    const second = contextOf(hook.run(startInput('startup', 'one-shot')));
    assert.ok(!/compaction/i.test(second), 'resume block NOT re-injected on the next start');
  });
});

test('a stale compaction scratch is discarded and cleared, not resumed', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_INSTINCTS_DIR: undefined, ESCC_COMPACTION_TTL_HOURS: '1' }, () => {
    const dir = path.join(home, 'escc', 'compaction');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'stale.json');
    fs.writeFileSync(fp, JSON.stringify({
      session_id: 'stale', created_at: '2000-01-01T00:00:00.000Z',
      task_intent: 'ancient task', pending_actions: [], findings: [], pending_tool_actions: [],
    }));
    const ctx = contextOf(hook.run(startInput('compact', 'stale')));
    assert.ok(!/ancient task/i.test(ctx), 'stale scratch is not resumed');
    assert.ok(!fs.existsSync(fp), 'stale scratch is cleared');
  });
});

test('budgetedJoin does not emit a lone surrogate at the cut', () => {
  const out = hook.budgetedJoin(['👍👍👍👍👍'], 4);
  assert.ok(out.length <= 4);
  assert.ok(!/[\uD800-\uDBFF]$/.test(out.replace(/…$/, '')), 'no trailing lone surrogate');
});

test('a /daily nudge is injected on startup only — never on resume/compact (ADR-0016)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_INSTINCTS_DIR: undefined }, () => {
    assert.ok(/\/daily/.test(contextOf(hook.run(startInput('startup')))), 'startup carries the /daily nudge');
    assert.ok(!/\/daily/.test(contextOf(hook.run(startInput('resume')))), 'resume is mid-flow — no nudge');
    assert.ok(!/\/daily/.test(contextOf(hook.run(startInput('compact')))), 'compact re-entry — no nudge');
    assert.equal(hook.buildDailyNudgeBlock('clear'), '', 'clear gets no nudge either');
  });
});
