'use strict';

/*
 * Unit tests for createStateStoreSync — the synchronous accessor used by the
 * lifecycle hooks (session-end, follow-through-check, sla-check), which run
 * inside the synchronous run(raw, ctx) hook contract and cannot await.
 *
 * It must expose the SAME query/upsert surface as the async createStateStore
 * (the JSONL backend is already synchronous; only the wrapper was async).
 */

const {
  createStateStore,
  createStateStoreSync,
} = require('../../scripts/lib/state-store/index.js');

test('createStateStoreSync is a synchronous factory (returns a store, not a Promise)', () => {
  const store = createStateStoreSync({ dbPath: ':memory:' });
  try {
    assert.ok(store && typeof store.upsertPromise === 'function', 'returns a store synchronously');
    assert.ok(typeof store.then !== 'function', 'must not be a thenable/Promise');
  } finally {
    store.close();
  }
});

test('createStateStoreSync round-trips a promise via listOpenPromises', () => {
  const store = createStateStoreSync({ dbPath: ':memory:' });
  try {
    store.upsertPromise({
      id: 'p-sync-1',
      account_id: 'acme',
      deal_id: 'deal-1',
      text: 'Send the security questionnaire',
      due_date: '2026-06-20',
    });
    const open = store.listOpenPromises();
    assert.equal(open.length, 1);
    assert.equal(open[0].id, 'p-sync-1');
    assert.equal(open[0].status, 'open');
    assert.equal(open[0].account_id, 'acme');
  } finally {
    store.close();
  }
});

test('createStateStoreSync and createStateStore expose the same method surface', async () => {
  const sync = createStateStoreSync({ dbPath: ':memory:' });
  const asyncStore = await createStateStore({ dbPath: ':memory:' });
  try {
    const syncKeys = Object.keys(sync).filter(k => typeof sync[k] === 'function').sort();
    const asyncKeys = Object.keys(asyncStore).filter(k => typeof asyncStore[k] === 'function').sort();
    assert.deepEqual(syncKeys, asyncKeys, 'sync and async stores expose identical method names');
  } finally {
    sync.close();
    asyncStore.close();
  }
});
