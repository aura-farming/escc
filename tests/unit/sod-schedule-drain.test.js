'use strict';

/*
 * Tests for v1.8.0 T3b: separation-of-duties overrides (approve-side refusal +
 * the gate's strict-profile branch — which must ONLY TIGHTEN), the scheduler
 * emit/install wiring, and the notify drain + self-digest token path proven
 * END-TO-END through the fail-closed send-gate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const approve = require('../../scripts/lib/outbound-approve');
const gate = require('../../scripts/hooks/outbound-send-gate');
const scheduleEmit = require('../../scripts/lib/schedule-emit');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-sod-'));
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

function draftCall(draft) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__claude_ai_Gmail__create_draft',
    tool_input: draft,
    session_id: 'sod-1',
  });
}

const BLOCKED_RECORDS = { open_deals: [{ id: 'd1' }], account_id: 'acme-sod' };

// --- separation of duties ---------------------------------------------------------

test('SoD: strict profile refuses a rep-role override at APPROVE time (no token, no blocklist writes)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome(), ESCC_HOOK_PROFILE: 'strict', ESCC_ROLE: undefined, ESCC_REP_ROLE: undefined, ESCC_OVERRIDE_REQUIRES_MANAGER: undefined }, () => {
    const draft = { to: 'x@y.com', subject: 'Hi', body: 'Cut overtime?' };
    const r = approve.approveOutbound({ draft, records: BLOCKED_RECORDS, override: 'urgent' });
    assert.equal(r.approved, false);
    assert.equal(r.sodRefused, true);
    assert.ok(r.blocks.some(b => b.gate === 'override-sod'));
    const dnc = require('../../scripts/lib/do-not-contact');
    assert.equal(dnc.findActiveBlock({ key: 'acme-sod' }), null, 'refused override writes NO blocklist rows');
    assert.equal(gate.run(draftCall(draft)).exitCode, 2, 'no token minted -> gate still blocks');
  });
});

test('SoD: a manager-signed override approves under strict, and the gate admits it', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome(), ESCC_HOOK_PROFILE: 'strict', ESCC_OVERRIDE_REQUIRES_MANAGER: undefined }, () => {
    const draft = { to: 'x@y.com', subject: 'Hi', body: 'Cut overtime?' };
    const r = approve.approveOutbound({ draft, records: BLOCKED_RECORDS, override: 'manager approved — strategic', approver: 'Dana Lee', approverRole: 'manager' });
    assert.equal(r.approved, true);
    assert.equal(gate.run(draftCall(draft)), undefined, 'manager-signed override token passes the strict gate');
  });
});

test('SoD gate branch ONLY TIGHTENS: standard profile behaves exactly as before', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome(), ESCC_HOOK_PROFILE: undefined, ESCC_OVERRIDE_REQUIRES_MANAGER: undefined, ESCC_ROLE: undefined, ESCC_REP_ROLE: undefined }, () => {
    const draft = { to: 'x@y.com', subject: 'Hi', body: 'Cut overtime?' };
    const r = approve.approveOutbound({ draft, records: BLOCKED_RECORDS, override: 'rep override, standard profile' });
    assert.equal(r.approved, true, 'standard profile: rep overrides still work (v1.1.0 behavior)');
    assert.equal(gate.run(draftCall(draft)), undefined, 'gate admits it exactly as before');
  });
});

test('SoD gate branch blocks a REP-signed override token under strict — but never a clean-pass token', () => {
  const home = freshHome();
  // Token minted under STANDARD by a rep override…
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_HOOK_PROFILE: undefined, ESCC_ROLE: undefined, ESCC_REP_ROLE: undefined }, () => {
    approve.approveOutbound({ draft: { to: 'x@y.com', subject: 'Hi', body: 'Cut overtime?' }, records: BLOCKED_RECORDS, override: 'rep override' });
    approve.approveOutbound({ draft: { to: 'clean@ok.com', subject: 'Yo', body: 'Worth a look at rostering?' }, records: { notes: [], open_deals: [] }, now: new Date().toISOString() });
  });
  // …then the workspace tightens to strict:
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_HOOK_PROFILE: 'strict' }, () => {
    const blocked = gate.run(draftCall({ to: 'x@y.com', subject: 'Hi', body: 'Cut overtime?' }));
    assert.equal(blocked.exitCode, 2, 'rep-signed override token no longer passes under strict');
    assert.match(blocked.stderr, /separation of duties/);
    assert.equal(gate.run(draftCall({ to: 'clean@ok.com', subject: 'Yo', body: 'Worth a look at rostering?' })), undefined, 'clean four-gates token is untouched by the SoD branch');
  });
});

// --- scheduler emit/install ---------------------------------------------------------

test('schedule emit: plist + crontab carry node, the escc entrypoint, watch, and the interval', () => {
  assert.equal(scheduleEmit.parseIntervalSeconds('30m'), 1800);
  assert.equal(scheduleEmit.parseIntervalSeconds('2h'), 7200);
  assert.equal(scheduleEmit.parseIntervalSeconds('junk'), scheduleEmit.DEFAULT_INTERVAL_SECONDS);
  const plist = scheduleEmit.emitLaunchdPlist({ intervalSeconds: 1800 });
  assert.match(plist, /<string>watch<\/string>/);
  assert.match(plist, /<integer>1800<\/integer>/);
  assert.ok(plist.includes(process.execPath), 'plist uses the running node');
  assert.match(plist, /escc\.js/);
  const cron = scheduleEmit.emitCrontabLine({ intervalSeconds: 1800 });
  assert.match(cron, /^\*\/30 \* \* \* \* /);
  assert.match(cron, /escc\.js watch$/);
});

test('schedule install writes the plist under HOME/Library/LaunchAgents', () => {
  const home = freshHome();
  const r = scheduleEmit.installLaunchd({ intervalSeconds: 3600, homeDir: home });
  assert.ok(fs.existsSync(r.plistPath));
  assert.ok(r.plistPath.startsWith(path.join(home, 'Library', 'LaunchAgents')));
  assert.match(r.loadCommand, /^launchctl load -w /);
});

// --- notify drain + self-digest token, END-TO-END through the gate -------------------

test('notify drain prints the queue; --approve-self mints a token the gate admits for EXACTLY that digest', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_NOTIFY_NO_DESKTOP: '1', ESCC_HOOK_PROFILE: undefined }, () => {
    const cli = require('../../scripts/escc.js');
    const notifyLib = require('../../scripts/lib/notify');
    notifyLib.notify({ severity: 'medium', title: 'Renewal window', message: 'Acme renewal enters the 90-day window', account: 'company_12345' });

    const emptyOk = cli.run(['notify', 'bogus']);
    assert.equal(emptyOk.code, 1, 'unknown action refused');

    const drained = cli.run(['notify', 'drain', '--approve-self', 'me@myco.com']);
    assert.equal(drained.code, 0);
    assert.match(drained.text, /Acme renewal/);
    assert.match(drained.text, /Self-digest approval token minted/);

    // The gate must admit a Gmail draft to SELF with EXACTLY the printed content…
    const admitted = gate.run(draftCall({ to: 'me@myco.com', subject: drained.data.subject, body: drained.data.body }));
    assert.equal(admitted, undefined, 'self-digest draft passes the fail-closed gate');

    // …and the token must be USELESS for any other recipient or content.
    assert.equal(gate.run(draftCall({ to: 'prospect@acme.com', subject: drained.data.subject, body: drained.data.body })).exitCode, 2, 'token cannot launder a prospect draft');
    assert.equal(gate.run(draftCall({ to: 'me@myco.com', subject: drained.data.subject, body: `${drained.data.body}\nP.S. buy now` })).exitCode, 2, 'token is bound to the exact content');
  });
});
