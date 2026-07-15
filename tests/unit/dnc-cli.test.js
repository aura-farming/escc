'use strict';

/*
 * Tests for `escc dnc` — the blessed CLI path that makes an inbound opt-out
 * HOOK-ENFORCED. Rows written by `dnc record` are the exact store the
 * fail-closed send-gate consults, so the E2E cases here drive the real hook:
 * CLI record -> gate blocks; CLI clear (with evidence) -> gate passes again.
 * Hermetic: each case points ESCC_AGENT_DATA_HOME at a fresh tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const escc = require('../../scripts/escc');
const dnc = require('../../scripts/lib/do-not-contact');
const identity = require('../../scripts/lib/account-identity');
const review = require('../../scripts/lib/outbound-review');
const gate = require('../../scripts/hooks/outbound-send-gate');

const DRAFT_TOOL = 'mcp__claude_ai_Gmail__create_draft';

function freshStateHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-dnccli-'));
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

function gateInput(toolInput) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'sess-dnc-1',
    tool_name: DRAFT_TOOL,
    tool_input: toolInput,
  });
}

/** Mint a valid approval for the draft, so DNC is the only thing that can block. */
function approveDraft(toolInput) {
  const key = review.outboundContentKey(review.extractOutboundPayload(DRAFT_TOOL, toolInput));
  review.recordApproval({ sessionId: 'sess-dnc-1', key, recipient: toolInput.to, confidence: 0.95 });
}

test('E2E: `escc dnc record` makes the send-gate BLOCK an already-approved draft', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'sam@acme.example', subject: 'Thursday', body: 'Hi Sam, quick one.' };
    approveDraft(toolInput);
    assert.equal(gate.run(gateInput(toolInput)), undefined, 'sanity: approved draft passes before the opt-out');

    const res = escc.run(['dnc', 'record', '--key', 'sam@acme.example', '--source', 'email', '--reason', 'opt-out: "please stop"']);
    assert.equal(res.code, 0, res.text);
    assert.match(res.text, /send-gate now blocks/i);

    const blocked = gate.run(gateInput(toolInput));
    assert.ok(blocked && blocked.exitCode === 2, 'the opt-out must beat the pre-existing approval');
    assert.match(blocked.stderr, /do-not-contact/i);
  });
});

test('record --scope account canonicalizes a bare domain and suppresses every contact there', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const res = escc.run(['dnc', 'record', '--key', 'acme.example', '--scope', 'account', '--reason', 'org-wide opt-out']);
    assert.equal(res.code, 0, res.text);
    assert.equal(res.data.key, identity.accountKey('acme.example'), 'stored under the ADR-0018 canonical account key');

    const toolInput = { to: 'someone.new@acme.example', subject: 'Hi', body: 'Hello there.' };
    approveDraft(toolInput);
    const blocked = gate.run(gateInput(toolInput));
    assert.ok(blocked && blocked.exitCode === 2);
    assert.match(blocked.stderr, /account is on the do-not-contact/i);
  });
});

test('record refuses a contact-scope key that is not an email (would gate nothing)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const res = escc.run(['dnc', 'record', '--key', 'acme.example']);
    assert.equal(res.code, 1);
    assert.match(res.text, /--scope account/);
    assert.equal(dnc.listDoNotContact().length, 0, 'nothing may be written on a refusal');
  });
});

test('record folds --source into the stored reason as provenance', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const res = escc.run(['dnc', 'record', '--key', 'dana@co.example', '--source', 'phone', '--reason', 'verbal opt-out']);
    assert.equal(res.code, 0);
    assert.match(res.data.reason, /verbal opt-out \[via phone\]/);
  });
});

test('clear refuses without --evidence; with evidence it lifts the block and the gate passes again', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'sam@acme.example', subject: 'Re-engage', body: 'Hi Sam.' };
    escc.run(['dnc', 'record', '--key', 'sam@acme.example', '--reason', 'asked us to stop']);

    const refused = escc.run(['dnc', 'clear', '--key', 'sam@acme.example']);
    assert.equal(refused.code, 1);
    assert.match(refused.text, /--evidence/);
    assert.ok(dnc.findActiveBlock({ key: 'sam@acme.example' }), 'the block must survive a refused clear');

    const cleared = escc.run(['dnc', 'clear', '--key', 'sam@acme.example', '--evidence', 'signed re-consent form 2026-07-15']);
    assert.equal(cleared.code, 0, cleared.text);
    assert.match(cleared.data.reason, /re-consent: signed re-consent form/);
    assert.equal(dnc.findActiveBlock({ key: 'sam@acme.example' }), null);

    approveDraft(toolInput);
    assert.equal(gate.run(gateInput(toolInput)), undefined, 'after a documented clear + fresh approval the gate passes');
  });
});

test('check mirrors the gate: reports a contact block, and an account block for a mere email', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    assert.match(escc.run(['dnc', 'check', '--key', 'sam@acme.example']).text, /Not blocked/);

    escc.run(['dnc', 'record', '--key', 'acme.example', '--scope', 'account', '--reason', 'org-wide']);
    const res = escc.run(['dnc', 'check', '--key', 'sam@acme.example']);
    assert.match(res.text, /BLOCKED \(account-scope\)/);

    const asJson = escc.run(['dnc', 'check', '--key', 'sam@acme.example', '--json']);
    assert.equal(JSON.parse(asJson.text).blocked, true);
  });
});

test('list shows folded rows (and --json round-trips); unknown actions are refused', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    escc.run(['dnc', 'record', '--key', 'sam@acme.example', '--reason', 'asked us to stop']);
    assert.match(escc.run(['dnc', 'list']).text, /sam@acme\.example — blocked indefinitely/);
    assert.equal(JSON.parse(escc.run(['dnc', 'list', '--json']).text).length, 1);
    assert.equal(escc.run(['dnc', 'purge-everything']).code, 1);
  });
});

test('help advertises the dnc verb', () => {
  assert.match(escc.HELP, /dnc record --key/);
  assert.match(escc.HELP, /--evidence/);
});

// --- max-quality hardening: addressee forms + not-before (v1.10.0) ----------

test('a display-name recipient ("Sam <sam@…>") cannot slip past the blocklist', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'Sam Jones <sam@acme.example>', subject: 'Hi', body: 'Quick one.' };
    approveDraft(toolInput); // valid token minted on the SAME display-name form
    assert.equal(gate.run(gateInput(toolInput)), undefined, 'sanity: display-name draft passes pre-opt-out (keys agree end-to-end)');

    escc.run(['dnc', 'record', '--key', 'sam@acme.example', '--reason', 'asked us to stop']);
    const blocked = gate.run(gateInput(toolInput));
    assert.ok(blocked && blocked.exitCode === 2, 'the bare-email block must catch the display-name form');
    assert.match(blocked.stderr, /sam@acme\.example is on the do-not-contact/i);
  });
});

test('a multi-recipient send is blocked when ANY addressee is suppressed', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const toolInput = { to: 'ok@corp.example, Sam <sam@acme.example>', subject: 'Team', body: 'Hello both.' };
    approveDraft(toolInput);
    assert.equal(gate.run(gateInput(toolInput)), undefined, 'sanity: passes before the opt-out');

    escc.run(['dnc', 'record', '--key', 'sam@acme.example', '--reason', 'asked us to stop']);
    const blocked = gate.run(gateInput(toolInput));
    assert.ok(blocked && blocked.exitCode === 2, 'the second addressee must still be screened');
  });
});

test('an account-scope block also catches a display-name recipient at that domain', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    escc.run(['dnc', 'record', '--key', 'acme.example', '--scope', 'account', '--reason', 'org-wide']);
    const toolInput = { to: 'New Person <new.person@acme.example>', subject: 'Hi', body: 'Hello.' };
    approveDraft(toolInput);
    const blocked = gate.run(gateInput(toolInput));
    assert.ok(blocked && blocked.exitCode === 2);
    assert.match(blocked.stderr, /account is on the do-not-contact/i);
  });
});

test('record refuses an unparseable --not-before instead of writing a block that never fires', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    const res = escc.run(['dnc', 'record', '--key', 'sam@acme.example', '--not-before', 'next tuesday']);
    assert.equal(res.code, 1);
    assert.match(res.text, /not a parseable date/);
    assert.equal(dnc.listDoNotContact().length, 0);
  });
});

test('FAIL CLOSED: a stored row with a garbled not_before still blocks (never reads as expired)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshStateHome() }, () => {
    dnc.recordDoNotContact({ key: 'sam@acme.example', notBefore: 'corrupted-date-value', reason: 'timing block' });
    assert.ok(dnc.findActiveBlock({ key: 'sam@acme.example' }), 'garbage not_before must read as still-blocked');
  });
});
