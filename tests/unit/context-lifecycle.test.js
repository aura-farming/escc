'use strict';

/*
 * A.2/A.3 GATE tests (C8 + A.9): the cross-hook round-trips that prove ESCC holds
 * context across sessions and months, not just one conversation. These exercise
 * the ACTUAL lifecycle hooks end-to-end:
 *   A. session:end -> session:start round-trip (promise + account memory survive)
 *   B. >7-day-gap resume: open loops still surface (decoupled from the 7-day gate)
 *   C. pre:compact -> session:start(compact) round-trip (resumable working state)
 *   D. multi-account attribution (per-account promise recall)
 * Hermetic: each case uses a fresh ESCC_AGENT_DATA_HOME.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sessionEnd = require('../../scripts/hooks/session-end');
const sessionStart = require('../../scripts/hooks/session-start');
const preCompact = require('../../scripts/hooks/pre-compact');
const accountMemory = require('../../scripts/lib/account-memory');
const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-ctxlife-'));
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

function writeTranscript(home, name, lines) {
  const dir = path.join(home, 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
  return fp;
}

function seedActivity(home, sessionId, accounts) {
  const dir = path.join(home, 'metrics', 'activity');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify({ session_id: sessionId, accounts }), 'utf8');
}

function contextOf(result) {
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

// --- A. session:end -> session:start round-trip -----------------------------

test('A. a promise + account context written at session end resurfaces at the next session start', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: 'company:acme', ESCC_INSTINCTS_DIR: undefined }, () => {
    // Session 1 ends: rep promised to send the proposal and worked the Acme deal.
    const tp = writeTranscript(home, 's1', [
      { type: 'user', message: { role: 'user', content: 'Move the Acme deal forward.' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: "Logged discovery. I'll send the proposal by 2099-01-01." }] } },
    ]);
    seedActivity(home, 's1', ['company:acme', 'deal:deal-1']);
    sessionEnd.run(JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 's1', transcript_path: tp }));

    // A brand-new session starts.
    const ctx = contextOf(sessionStart.run(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's2' })));
    assert.ok(/proposal/i.test(ctx), 'the promise made last session is surfaced as an open loop');
    assert.ok(/acme/i.test(ctx), 'the active account context is hydrated');
  });
});

// --- B. >7-day-gap resume (A.9 long-horizon proof) --------------------------

test('B. an open loop from >7 days ago still surfaces, with a welcome-back note', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined, ESCC_INSTINCTS_DIR: undefined }, () => {
    // A promise created long ago, still open and overdue.
    const store = createStateStoreSync();
    try {
      store.upsertPromise({
        id: 'p-old',
        account_id: 'initech',
        text: 'Send the signed order form',
        due_date: '2026-01-01',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
    } finally {
      store.close();
    }
    // A session summary from 20 days ago.
    const sdir = path.join(home, 'session-data');
    fs.mkdirSync(sdir, { recursive: true });
    const fp = path.join(sdir, '2026-05-20-old-session.tmp');
    fs.writeFileSync(fp, '# Session\n---\n<!-- ESCC:SUMMARY:START -->\nWorked the Initech order form.\n<!-- ESCC:SUMMARY:END -->\n');
    const old = Date.now() - 20 * 24 * 60 * 60 * 1000;
    fs.utimesSync(fp, new Date(old), new Date(old));

    const ctx = contextOf(sessionStart.run(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sB' })));
    assert.ok(/order form/i.test(ctx), 'the months-old open loop still surfaces (decoupled from the 7-day gate)');
    assert.ok(/overdue/i.test(ctx), 'it is flagged overdue');
    assert.ok(/welcome back|been \d+ day/i.test(ctx), 'welcome-back digest after the gap');
  });
});

// --- C. pre:compact -> session:start(compact) round-trip --------------------

test('C. working state saved at pre:compact is restored at the next session start', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: 'company:bigco', ESCC_INSTINCTS_DIR: undefined }, () => {
    const tp = writeTranscript(home, 'c1', [
      { type: 'user', message: { role: 'user', content: 'Negotiate the BigCo renewal.' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Next step: send the redlined MSA. Waiting on procurement.' }] } },
    ]);
    preCompact.run(JSON.stringify({ hook_event_name: 'PreCompact', session_id: 'cs', transcript_path: tp, trigger: 'manual' }));

    const ctx = contextOf(sessionStart.run(JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'cs' })));
    assert.ok(/compaction/i.test(ctx), 'labels the resume-from-compaction block');
    assert.ok(/BigCo renewal/i.test(ctx), 'task intent restored');
    assert.ok(/redlined MSA|procurement/i.test(ctx), 'pending action restored');
  });
});

// --- D. multi-account attribution -------------------------------------------

test('D. promises are attributed per account and recalled per account', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: 'acme', ESCC_INSTINCTS_DIR: undefined }, () => {
    const store = createStateStoreSync();
    try {
      store.upsertPromise({ id: 'pa', account_id: 'acme', text: 'Acme: send the SOW', due_date: '2020-01-01' });
      store.upsertPromise({ id: 'pg', account_id: 'globex', text: 'Globex: book the exec sync', due_date: '2020-01-01' });
    } finally {
      store.close();
    }
    // Per-account recall is exact.
    const store2 = createStateStoreSync();
    try {
      const acme = store2.getPromisesByAccount('acme');
      const globex = store2.getPromisesByAccount('globex');
      assert.equal(acme.length, 1);
      assert.equal(acme[0].text, 'Acme: send the SOW');
      assert.equal(globex.length, 1);
      assert.equal(globex[0].account_id, 'globex');
    } finally {
      store2.close();
    }

    // Active-account context hydrates ONLY the active account; overdue list spans all.
    accountMemory.appendEvent('acme', { type: 'note', text: 'Acme champion: VP Sales' });
    const ctx = contextOf(sessionStart.run(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sd' })));
    assert.ok(/VP Sales/i.test(ctx), 'active account (acme) memory is hydrated');
    assert.ok(/send the SOW/i.test(ctx) && /book the exec sync/i.test(ctx), 'overdue list spans all accounts');
  });
});

// --- E. long-horizon (A.9): a deal-scoped promise + account context created in an
//        EARLIER session (>7 days prior) resurface for the ACTIVE DEAL at a later
//        session start. Composes the proven pieces — A (end->start round-trip),
//        B (>7-day decoupling), D (per-deal attribution) — into the exact §A.9
//        long-horizon success criterion: context held across months, not one chat.

test('E. a deal-scoped promise + account context from a session >7 days ago resurface for the active deal', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: home, ESCC_ACTIVE_ACCOUNT: 'company:initech', ESCC_INSTINCTS_DIR: undefined }, () => {
    const longAgoIso = '2026-01-01T00:00:00.000Z'; // well over 7 days before "now"

    // Session 1 ends: the rep worked the Initech renewal and recorded the champion.
    const tp = writeTranscript(home, 's1-old', [
      { type: 'user', message: { role: 'user', content: 'Work the Initech renewal — procurement is reviewing the order form.' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Logged discovery on the Initech renewal; next step is the signed order form.' }] } },
    ]);
    seedActivity(home, 's1-old', ['company:initech', 'deal:initech-renewal']);
    sessionEnd.run(JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 's1-old', transcript_path: tp }));
    accountMemory.appendEvent('company:initech', { type: 'note', text: 'Initech champion: VP Ops' });

    // Back-date everything session 1 produced so the gap to "now" is > 7 days.
    const sdir = path.join(home, 'session-data');
    if (fs.existsSync(sdir)) {
      const oldMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const f of fs.readdirSync(sdir)) fs.utimesSync(path.join(sdir, f), new Date(oldMs), new Date(oldMs));
    }

    // The deal-scoped promise made back then — still open, now long overdue.
    const store = createStateStoreSync();
    try {
      store.upsertPromise({
        id: 'p-initech-of',
        account_id: 'company:initech',
        deal_id: 'initech-renewal',
        text: 'Send the signed order form',
        due_date: '2026-01-05',
        created_at: longAgoIso,
        updated_at: longAgoIso,
      });
    } finally {
      store.close();
    }

    // Session N (a fresh session, much later) must STILL surface both the
    // deal-scoped open loop and the active-deal account context.
    const ctx = contextOf(sessionStart.run(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sN-initech' })));
    assert.ok(/order form/i.test(ctx), 'the deal-scoped promise from the earlier session resurfaces (decoupled from the 7-day gate)');
    assert.ok(/overdue/i.test(ctx), 'the months-old promise is flagged overdue');
    assert.ok(/VP Ops/i.test(ctx), 'the active-deal (Initech) account context is hydrated alongside the open loop');
  });
});
