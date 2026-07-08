'use strict';

/*
 * Tests for scripts/lib/privacy-purge.js — GDPR/erasure orchestration mounted by
 * `escc privacy-purge <identifier>` (spec §A.6). Erasure spans the entity-scoped
 * local stores ESCC owns: account-memory files, instinct observations, and
 * instinct evidence. Multi-entity records (other accounts' logs, session
 * summaries) and the HubSpot record itself are NOT auto-shredded — they are
 * reported for manual review / crm-operator handling.
 *
 * Safety contract proven here:
 *   - default is DRY-RUN: scans + reports, mutates nothing;
 *   - --confirm performs entity-scoped erasure (own account files, matching
 *     observations, instinct evidence — scrub or remove);
 *   - an empty identifier is refused;
 *   - an unknown identifier is a clean no-op.
 *
 * Hermetic: ESCC_AGENT_DATA_HOME (accounts + session-data) + ESCC_INSTINCT_HOME
 * + ESCC_REP_IDENTITY (instinct store) all point at tmpdirs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const accountMemory = require('../../scripts/lib/account-memory');
const store = require('../../scripts/instincts/instinct-store');
const session = require('../../scripts/lib/session-manager');
const purgeLib = require('../../scripts/lib/privacy-purge');
const { createStateStoreSync } = require('../../scripts/lib/state-store');
const notify = require('../../scripts/lib/notify');
const sessionSignal = require('../../scripts/lib/session-signal');

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

function instinct(overrides = {}) {
  return {
    id: 'i1',
    trigger: 'when doing sales work',
    confidence: 0.6,
    domain: 'process',
    scope: 'personal',
    source: 'user_correction',
    created: '2026-06-01T00:00:00.000Z',
    last_observed: '2026-06-01T00:00:00.000Z',
    action: 'do the thing',
    evidence: ['seen'],
    ...overrides,
  };
}

const SUBJECT = 'acme.test';

// Seed all the stores with a mix of subject-referencing and unrelated data.
function seedStores() {
  // account-memory: the subject's own record + an unrelated account that merely
  // mentions the subject.
  accountMemory.appendEvent(SUBJECT, { type: 'note', text: 'met the CEO at acme.test' });
  accountMemory.appendEvent('beta-corp', { type: 'note', text: 'beta intro via acme.test contact' });

  // observations: one references the subject, one does not.
  store.appendObservation({ kind: 'tool_use', tool: 'hubspot', text: 'logged acme.test deal' });
  store.appendObservation({ kind: 'tool_use', tool: 'editor', text: 'unrelated note' });

  // instincts: scrub-target (one evidence line mentions subject), remove-target
  // (trigger mentions subject), and a clean one.
  store.writeInstinct(instinct({ id: 'scrub-me', evidence: ['acme.test renewal pattern', 'general cadence note'] }));
  store.writeInstinct(instinct({ id: 'remove-me', trigger: 'when emailing acme.test buyers' }));
  store.writeInstinct(instinct({ id: 'clean', evidence: ['unrelated signal'] }));

  // session-data: one summary references the subject, one does not.
  const dir = session.getSessionDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-06-16-aaa-session.tmp'), '# Session\nNotes on acme.test discovery call\n');
  fs.writeFileSync(path.join(dir, '2026-06-16-bbb-session.tmp'), '# Session\nNothing relevant here\n');
}

function freshEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-purge-home-'));
  const inst = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-purge-inst-'));
  return { ESCC_AGENT_DATA_HOME: home, ESCC_INSTINCT_HOME: inst, ESCC_REP_IDENTITY: 'rep-purge' };
}

test('dry-run reports erasure targets but mutates nothing', () => {
  withEnv(freshEnv(), () => {
    seedStores();
    const res = purgeLib.purge({ identifier: SUBJECT });

    assert.equal(res.confirmed, false, 'dry-run not confirmed');
    assert.ok(res.erased.accountFiles.some(p => p.endsWith(`${SUBJECT}.jsonl`)), 'own account jsonl targeted');
    assert.ok(res.erased.observationsRemoved >= 1, 'a matching observation targeted');
    assert.deepEqual(res.erased.instinctsRemoved.sort(), ['remove-me']);
    assert.deepEqual(res.erased.instinctsScrubbed.sort(), ['scrub-me']);
    assert.ok(/crm-operator|hubspot/i.test(res.manualReview.hubspot), 'HubSpot deletion flagged as manual');
    assert.ok(res.manualReview.sessionFiles.some(p => /aaa-session/.test(p)), 'referencing session flagged');
    assert.ok(res.manualReview.accountReferences.some(p => /beta-corp/.test(p)), 'cross-referencing account flagged');

    // Nothing actually changed.
    assert.equal(fs.existsSync(accountMemory.accountFile(SUBJECT)), true, 'account file still present in dry-run');
    assert.equal(store.readObservations().length, 2, 'observations untouched in dry-run');
    assert.equal(store.readInstincts('personal').length, 3, 'instincts untouched in dry-run');
  });
});

test('--confirm erases entity-scoped data (account files, observations, instincts)', () => {
  withEnv(freshEnv(), () => {
    seedStores();
    const res = purgeLib.purge({ identifier: SUBJECT, confirm: true });
    assert.equal(res.confirmed, true);

    // account files gone.
    assert.equal(fs.existsSync(accountMemory.accountFile(SUBJECT)), false, 'subject jsonl erased');
    assert.equal(fs.existsSync(accountMemory.markdownFile(SUBJECT)), false, 'subject md erased');
    assert.equal(fs.existsSync(accountMemory.accountFile('beta-corp')), true, 'unrelated account preserved');

    // observations: the matching row gone, the unrelated one survives.
    const obs = store.readObservations();
    assert.equal(obs.length, 1, 'only the unrelated observation survives');
    assert.ok(!obs.some(o => JSON.stringify(o).toLowerCase().includes(SUBJECT)), 'no subject reference remains');

    // instincts: remove-me gone; scrub-me kept without the subject evidence line; clean intact.
    const ids = store.readInstincts('personal').map(i => i.id).sort();
    assert.deepEqual(ids, ['clean', 'scrub-me']);
    const scrubbed = store.readInstincts('personal').find(i => i.id === 'scrub-me');
    assert.ok(!scrubbed.evidence.some(e => e.toLowerCase().includes(SUBJECT)), 'subject evidence line removed');
    assert.ok(scrubbed.evidence.length >= 1, 'unrelated evidence retained');
  });
});

test('an empty identifier is refused (no erasure)', () => {
  withEnv(freshEnv(), () => {
    seedStores();
    const res = purgeLib.runPurge({ identifier: '   ', confirm: true });
    assert.equal(res.code, 1, 'refused with non-zero code');
    assert.ok(/identifier/i.test(res.text), 'explains the missing identifier');
    assert.equal(store.readInstincts('personal').length, 3, 'nothing erased on refusal');
  });
});

test('an unknown identifier is a clean no-op', () => {
  withEnv(freshEnv(), () => {
    seedStores();
    const res = purgeLib.purge({ identifier: 'no-such-entity-xyz', confirm: true });
    assert.equal(res.confirmed, true);
    assert.equal(res.erased.accountFiles.length, 0);
    assert.equal(res.erased.observationsRemoved, 0);
    assert.equal(res.erased.instinctsRemoved.length, 0);
    assert.equal(res.erased.instinctsScrubbed.length, 0);
    // unrelated data fully intact.
    assert.equal(store.readInstincts('personal').length, 3);
    assert.equal(store.readObservations().length, 2);
  });
});

test('runPurge refuses an identifier too short to purge safely', () => {
  withEnv(freshEnv(), () => {
    seedStores();
    const res = purgeLib.runPurge({ identifier: 'io', confirm: true });
    assert.equal(res.code, 1, 'a 2-char substring key is refused');
    assert.ok(/too short/i.test(res.text));
    assert.equal(store.readObservations().length, 2, 'nothing erased on refusal');
  });
});

test('applies_to is matched by exact segment token, not substring (no over-removal)', () => {
  withEnv(freshEnv(), () => {
    store.writeInstinct(instinct({ id: 'seg-a', applies_to: 'enterprise,mid-market', evidence: ['x'] }));
    store.writeInstinct(instinct({ id: 'seg-b', applies_to: 'acme.test', evidence: ['y'] }));

    // 'mid' is a substring of 'mid-market' but NOT an exact token -> nothing removed.
    const r1 = purgeLib.purge({ identifier: 'mid', confirm: true });
    assert.deepEqual(r1.erased.instinctsRemoved.sort(), [], 'a segment substring must not remove an instinct');
    assert.equal(store.readInstincts('personal').length, 2, 'both instincts survive a substring match');

    // an exact applies_to token still erases the account-scoped instinct.
    const r2 = purgeLib.purge({ identifier: 'acme.test', confirm: true });
    assert.deepEqual(r2.erased.instinctsRemoved.sort(), ['seg-b'], 'exact applies_to token still erases');
  });
});

test('the legacy sessions/ directory is also scanned for references', () => {
  withEnv(freshEnv(), () => {
    accountMemory.appendEvent('acme.test', { type: 'note', text: 'x' });
    const legacyDir = path.join(session.getSessionDataDir(), '..', 'sessions');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, '2025-01-01-legacy-session.tmp'), 'old notes about acme.test\n');
    const res = purgeLib.purge({ identifier: 'acme.test' });
    assert.ok(res.manualReview.sessionFiles.some(p => /legacy-session/.test(p)), 'a legacy session reference is surfaced');
  });
});

// --- ADR-0019 D1: purge reaches the twin-writer stores -----------------------

// Seed the state-store tables + sidecar queues each v1.9.0 learning/prep writer
// lands rows in: one row referencing the subject, one unrelated.
function seedTwinStores() {
  const db = createStateStoreSync();
  db.insertOutcome({ id: 'o-sub', type: 'reply_received', account_id: SUBJECT });
  db.insertOutcome({ id: 'o-other', type: 'reply_received', account_id: 'beta-corp' });
  db.upsertPromise({ id: 'p-sub', account_id: SUBJECT, text: 'follow up with them' });
  db.upsertPromise({ id: 'p-other', account_id: 'beta-corp', text: 'ping beta' });
  db.upsertWorkItem({ id: 'w-sub', source: 'morning-prep', sourceId: SUBJECT, title: 'Call prep', status: 'open' });
  db.upsertWorkItem({ id: 'w-other', source: 'morning-prep', sourceId: 'beta-corp', title: 'Call prep', status: 'open' });
  db.close();

  const queue = notify.resolveQueuePath();
  fs.mkdirSync(path.dirname(queue), { recursive: true });
  fs.writeFileSync(queue, [
    JSON.stringify({ ts: '2026-07-01T00:00:00Z', severity: 'high', title: 'Deal alert', message: 'movement', account: SUBJECT }),
    JSON.stringify({ ts: '2026-07-01T00:00:00Z', severity: 'high', title: 'Deal alert', message: 'movement', account: 'beta-corp' }),
  ].join('\n') + '\n');

  const soPath = sessionSignal.sessionOutcomesPath();
  fs.mkdirSync(path.dirname(soPath), { recursive: true });
  fs.writeFileSync(soPath, [
    JSON.stringify({ session_id: 's-sub', account: SUBJECT, metrics: { draftsCreated: 1 } }),
    JSON.stringify({ session_id: 's-other', metrics: { draftsCreated: 2 } }),
  ].join('\n') + '\n');
}

test('dry-run reports twin-store erasure targets but mutates nothing', () => {
  withEnv(freshEnv(), () => {
    seedTwinStores();
    const res = purgeLib.purge({ identifier: SUBJECT });
    assert.equal(res.confirmed, false);
    assert.equal(res.erased.outcomesRemoved, 1, 'one subject outcome targeted');
    assert.equal(res.erased.promisesRemoved, 1, 'one subject promise targeted');
    assert.equal(res.erased.workItemsRemoved, 1, 'one subject work item targeted');
    assert.equal(res.erased.notificationsRemoved, 1, 'one subject notification targeted');
    assert.equal(res.erased.sessionOutcomesRemoved, 1, 'one subject session-metric row targeted');

    // dry-run mutated nothing.
    const db = createStateStoreSync();
    assert.equal(db.listOutcomes().length, 2, 'outcomes untouched in dry-run');
    db.close();
  });
});

test('--confirm erases twin-store rows referencing the subject; unrelated survive', () => {
  withEnv(freshEnv(), () => {
    seedTwinStores();
    const res = purgeLib.purge({ identifier: SUBJECT, confirm: true });
    assert.equal(res.confirmed, true);

    const db = createStateStoreSync();
    assert.deepEqual(db.listOutcomes().map(o => o.id), ['o-other'], 'only the unrelated outcome survives');
    assert.deepEqual(db.listWorkItems().items.map(w => w.id).sort(), ['w-other'], 'only the unrelated work item survives');
    assert.ok(!db.listOpenPromises().some(p => p.id === 'p-sub'), 'subject promise erased');
    assert.ok(db.listOpenPromises().some(p => p.id === 'p-other'), 'unrelated promise survives');
    db.close();

    const queueRows = fs.readFileSync(notify.resolveQueuePath(), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(queueRows.length, 1, 'one notification survives');
    assert.equal(queueRows[0].account, 'beta-corp', 'the surviving notification is the unrelated one');

    const soRows = fs.readFileSync(sessionSignal.sessionOutcomesPath(), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.deepEqual(soRows.map(r => r.session_id), ['s-other'], 'only the unrelated session-metric row survives');
  });
});
