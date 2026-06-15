'use strict';

/*
 * Unit tests for scripts/lib/state-store.
 *
 * Covers the in-memory backend (round-trips, status shape, promises, outcomes,
 * schema validation) plus a real disk round-trip in os.tmpdir().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createStateStore,
} = require('../../scripts/lib/state-store/index.js');

// --- in-memory: session round-trip -----------------------------------------

test('state-store: upsertSession then getSessionById round-trips', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    const inserted = store.upsertSession({
      id: 'sess-round-trip',
      adapterId: 'adapter-a',
      harness: 'claude-code',
      state: 'active',
      repoRoot: '/tmp/repo',
    });
    assert.equal(inserted.id, 'sess-round-trip');
    assert.equal(inserted.harness, 'claude-code');

    const fetched = store.getSessionById('sess-round-trip');
    assert.ok(fetched, 'getSessionById should return the session');
    assert.equal(fetched.id, 'sess-round-trip');
    assert.equal(fetched.adapterId, 'adapter-a');
    assert.equal(fetched.state, 'active');
    assert.equal(fetched.repoRoot, '/tmp/repo');
  } finally {
    store.close();
  }
});

test('state-store: getSessionById returns null for unknown id', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    assert.equal(store.getSessionById('does-not-exist'), null);
  } finally {
    store.close();
  }
});

// --- in-memory: skill runs + decisions surface via getSessionDetail ---------

test('state-store: insertSkillRun + insertDecision appear in getSessionDetail', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    store.upsertSession({
      id: 'sess-detail',
      adapterId: 'adapter-a',
      harness: 'claude-code',
      state: 'active',
    });

    store.insertSkillRun({
      id: 'run-1',
      skillId: 'lead-intelligence',
      skillVersion: '1.0.0',
      sessionId: 'sess-detail',
      taskDescription: 'enrich a lead',
      outcome: 'success',
    });
    store.insertDecision({
      id: 'dec-1',
      sessionId: 'sess-detail',
      title: 'Use HubSpot connector',
      rationale: 'Existing integration pattern',
      status: 'accepted',
    });

    const detail = store.getSessionDetail('sess-detail');
    assert.ok(detail, 'getSessionDetail should return a record');
    assert.equal(detail.session.id, 'sess-detail');
    assert.equal(detail.skillRuns.length, 1);
    assert.equal(detail.skillRuns[0].id, 'run-1');
    assert.equal(detail.skillRuns[0].outcome, 'success');
    assert.equal(detail.decisions.length, 1);
    assert.equal(detail.decisions[0].id, 'dec-1');
  } finally {
    store.close();
  }
});

// --- in-memory: work items via listWorkItems --------------------------------

test('state-store: upsertWorkItem persists and appears in listWorkItems', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    const item = store.upsertWorkItem({
      id: 'wi-1',
      source: 'jira',
      sourceId: 'ESCC-42',
      title: 'Fix forecast rollup',
      status: 'open',
      priority: 'high',
    });
    assert.ok(item, 'upsertWorkItem should return the stored item');
    assert.equal(item.id, 'wi-1');
    assert.equal(item.status, 'open');

    const listing = store.listWorkItems();
    assert.equal(listing.totalCount, 1);
    assert.equal(listing.items.length, 1);
    assert.equal(listing.items[0].id, 'wi-1');

    // upsert is last-write-wins on the primary key.
    store.upsertWorkItem({
      id: 'wi-1',
      source: 'jira',
      title: 'Fix forecast rollup',
      status: 'done',
    });
    const after = store.listWorkItems();
    assert.equal(after.totalCount, 1, 'upsert must not create a duplicate row');
    assert.equal(after.items[0].status, 'done');
  } finally {
    store.close();
  }
});

// --- in-memory: getStatus documented shape ----------------------------------

test('state-store: getStatus returns the documented shape', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    store.upsertSession({
      id: 'sess-status',
      adapterId: 'adapter-a',
      harness: 'claude-code',
      state: 'active',
    });
    store.insertSkillRun({
      id: 'run-status',
      skillId: 'sk',
      skillVersion: '1.0.0',
      sessionId: 'sess-status',
      taskDescription: 'do work',
      outcome: 'success',
    });
    store.upsertWorkItem({
      id: 'wi-status',
      source: 'manual',
      title: 'review',
      status: 'open',
    });

    const status = store.getStatus();

    // Top-level keys.
    for (const key of ['generatedAt', 'readiness', 'activeSessions', 'skillRuns', 'installHealth', 'governance', 'workItems']) {
      assert.ok(Object.prototype.hasOwnProperty.call(status, key), `status missing key: ${key}`);
    }

    // readiness shape.
    for (const key of ['status', 'attentionCount', 'activeSessions', 'failedSkillRuns', 'warningInstallations', 'pendingGovernanceEvents', 'blockedWorkItems']) {
      assert.ok(Object.prototype.hasOwnProperty.call(status.readiness, key), `readiness missing key: ${key}`);
    }

    assert.equal(status.activeSessions.activeCount, 1);
    assert.equal(status.activeSessions.sessions.length, 1);
    assert.equal(status.skillRuns.summary.totalCount, 1);
    assert.equal(status.skillRuns.summary.successCount, 1);
    assert.equal(status.workItems.totalCount, 1);
    assert.equal(status.installHealth.status, 'missing');
    assert.equal(status.governance.pendingCount, 0);
  } finally {
    store.close();
  }
});

// --- in-memory: promises open vs done ---------------------------------------

test('state-store: upsertPromise + listOpenPromises filters open vs done', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    store.upsertPromise({ id: 'p-open', text: 'call back Tuesday', status: 'open', accountId: 'acct-1' });
    store.upsertPromise({ id: 'p-done', text: 'send the deck', status: 'done', accountId: 'acct-1' });
    store.upsertPromise({ id: 'p-open-2', text: 'follow up pricing', status: 'open', accountId: 'acct-2' });

    const open = store.listOpenPromises();
    const openIds = open.map(p => p.id).sort();
    assert.deepEqual(openIds, ['p-open', 'p-open-2']);
    assert.ok(!openIds.includes('p-done'), 'done promise must not appear in open list');

    // Account filter.
    const acct1 = store.listOpenPromises({ accountId: 'acct-1' });
    assert.equal(acct1.length, 1);
    assert.equal(acct1[0].id, 'p-open');

    // Transition open -> done removes it from the open list (last-write-wins).
    store.upsertPromise({ id: 'p-open', text: 'call back Tuesday', status: 'done', accountId: 'acct-1' });
    const openAfter = store.listOpenPromises().map(p => p.id);
    assert.ok(!openAfter.includes('p-open'), 'completed promise must drop out of open list');
  } finally {
    store.close();
  }
});

// --- in-memory: outcomes by type --------------------------------------------

test('state-store: insertOutcome + listOutcomes filters by type', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    store.insertOutcome({ id: 'o-1', type: 'reply_received', accountId: 'acct-1' });
    store.insertOutcome({ id: 'o-2', type: 'meeting_booked', accountId: 'acct-1' });
    store.insertOutcome({ id: 'o-3', type: 'reply_received', accountId: 'acct-2' });

    const all = store.listOutcomes();
    assert.equal(all.length, 3);

    const replies = store.listOutcomes({ type: 'reply_received' });
    assert.equal(replies.length, 2);
    assert.ok(replies.every(o => o.type === 'reply_received'));

    const meetings = store.listOutcomes({ type: 'meeting_booked' });
    assert.equal(meetings.length, 1);
    assert.equal(meetings[0].id, 'o-2');

    const byAccount = store.listOutcomes({ type: 'reply_received', accountId: 'acct-2' });
    assert.equal(byAccount.length, 1);
    assert.equal(byAccount[0].id, 'o-3');
  } finally {
    store.close();
  }
});

// --- schema validation ------------------------------------------------------

test('state-store: assertValidEntity rejects an invalid record', async () => {
  const store = await createStateStore({ dbPath: ':memory:' });
  try {
    // Missing required fields (adapterId, harness, state, snapshot, ...) and an
    // empty id (violates nonEmptyString minLength: 1).
    assert.throws(
      () => store.assertValidEntity('session', { id: '' }),
      /Invalid session/,
      'an empty/incomplete session must be rejected'
    );

    // A valid session must NOT throw.
    assert.doesNotThrow(() => store.assertValidEntity('session', {
      id: 'ok',
      adapterId: 'a',
      harness: 'h',
      state: 'active',
      repoRoot: null,
      startedAt: null,
      endedAt: null,
      snapshot: {},
    }));

    // Unknown entity name must throw too.
    assert.throws(() => store.assertValidEntity('not-an-entity', {}));
  } finally {
    store.close();
  }
});

// --- disk round-trip --------------------------------------------------------

test('state-store: disk round-trip (write, close, reopen, read back)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-test-state-'));
  const dbPath = path.join(dir, 'escc-test-state');
  try {
    let store = await createStateStore({ dbPath });
    store.upsertSession({
      id: 'disk-sess',
      adapterId: 'adapter-disk',
      harness: 'claude-code',
      state: 'active',
    });
    store.upsertWorkItem({
      id: 'disk-wi',
      source: 'jira',
      title: 'persisted item',
      status: 'open',
    });
    assert.equal(store.dbPath, path.resolve(dbPath));
    store.close();

    // A JSONL file should now exist on disk.
    assert.ok(
      fs.existsSync(path.join(path.resolve(dbPath), 'sessions.jsonl')),
      'sessions.jsonl should be written to disk'
    );

    // Reopen and confirm the data survived the close.
    store = await createStateStore({ dbPath });
    const session = store.getSessionById('disk-sess');
    assert.ok(session, 'session should survive a close/reopen cycle');
    assert.equal(session.adapterId, 'adapter-disk');

    const items = store.listWorkItems();
    assert.equal(items.totalCount, 1);
    assert.equal(items.items[0].id, 'disk-wi');
    store.close();
  } finally {
    // Clean up the temp dir.
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
