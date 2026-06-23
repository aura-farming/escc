/*
 * ESCC do-not-contact blocklist (NEW for ESCC, v1.1.0).
 *
 * A small synchronous store over the `do_not_contact` JSONL table. The four
 * gates (timing / contactability) write blocked contacts and accounts here with
 * a reason and an optional not-before date; the fail-closed send-gate hook reads
 * it on every gated outbound and BLOCKS a send to a currently-blocked party.
 *
 * Keyed by a normalized contact email or account id, last-write-wins (a later
 * record — e.g. a clear, or an extended not-before — supersedes). All reads/
 * writes are synchronous so the gate can consult it inside run(raw, ctx).
 */

'use strict';

const { createStateStoreSync } = require('./state-store');

/** Normalize a contact email or account id into a stable blocklist key. */
function normalizeContactKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function openStore(options = {}) {
  return options.stateDir
    ? createStateStoreSync({ dbPath: options.stateDir })
    : createStateStoreSync(options);
}

/**
 * Record (or update) a do-not-contact entry.
 * @param {{key:string, scope?:'contact'|'account', reason?:string,
 *   notBefore?:(string|null), sessionId?:string, cleared?:boolean,
 *   now?:string, stateDir?:string}} args
 * @returns {object} the stored row
 */
function recordDoNotContact(args = {}) {
  const key = normalizeContactKey(args.key);
  if (!key) throw new Error('recordDoNotContact: a contact/account key is required');
  const ts = args.now || new Date().toISOString();
  const row = {
    key,
    scope: args.scope === 'account' ? 'account' : 'contact',
    reason: String(args.reason || 'do-not-contact'),
    not_before: args.notBefore ?? args.not_before ?? null,
    source_session: args.sessionId || null,
    cleared: !!args.cleared,
    created_at: ts,
    updated_at: ts,
  };
  const store = openStore(args);
  try {
    store.upsertDoNotContact(row);
  } finally {
    store.close();
  }
  return row;
}

/**
 * Return the active block for a contact/account, or null. A block is active
 * when it is not cleared AND (it is indefinite, or its not-before date is still
 * in the future relative to `now`).
 * @param {{key:string, now?:(string|Date), stateDir?:string}} args
 * @returns {object|null}
 */
function findActiveBlock(args = {}) {
  const key = normalizeContactKey(args.key);
  if (!key) return null;
  const now = args.now ? new Date(args.now) : new Date();
  const store = openStore(args);
  let rows;
  try {
    rows = store.listDoNotContact().filter(r => r.key === key);
  } finally {
    store.close();
  }
  if (!rows.length) return null;
  const row = rows[0]; // folded last-write-wins by key → at most one
  if (row.cleared) return null;
  if (row.not_before == null) return row; // indefinite suppression
  return new Date(row.not_before) > now ? row : null;
}

/** List all (folded) do-not-contact rows. */
function listDoNotContact(args = {}) {
  const store = openStore(args);
  try {
    return store.listDoNotContact();
  } finally {
    store.close();
  }
}

/** Lift a block by appending a cleared record (last-write-wins). */
function clearDoNotContact(args = {}) {
  return recordDoNotContact({ ...args, cleared: true, reason: args.reason || 'cleared' });
}

module.exports = {
  normalizeContactKey,
  recordDoNotContact,
  findActiveBlock,
  listDoNotContact,
  clearDoNotContact,
};
