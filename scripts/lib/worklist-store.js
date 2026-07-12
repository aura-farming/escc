'use strict';

/*
 * ESCC prepared-day worklist store (NEW for ESCC; v1.9.0, ADR-0019).
 *
 * The morning sweep (lane L-C: the first /daily of the day) pre-stages prepared
 * work — "there is a 10:00 with company:12345; call-prep is queued" — so it
 * survives across sessions until the rep works it. This is the persistent
 * companion to scripts/lib/worklist.js (which is the STATELESS four-gate
 * review-pack splitter — do not confuse them).
 *
 * Storage: the state-store `work_items` table (source:'morning-prep'). Per
 * ADR-0019 the stored row is STRUCTURED WHITELISTED FIELDS ONLY — a canonical
 * account key, an ISO meeting time, a skill pointer, provenance stamps. It
 * NEVER stores prospect-authored free text (a calendar invite title/body): such
 * a string, persisted and re-injected at session-start, would be a durable
 * cross-session prompt-injection vector. The human-readable title is composed
 * deterministically from the safe fields; brief bodies are rendered live in
 * /daily, never persisted here. work_items is a DERIVED-CACHE store (ADR-0018):
 * reconstructable from the calendar + CRM, safe to purge (privacy-purge D1).
 */

const identity = require('./account-identity');

const MORNING_PREP_SOURCE = 'morning-prep';

// The ONLY metadata keys a prepared item may carry. Anything else is dropped —
// the whitelist is the injection firewall, so keep it structured + safe.
const META_KEYS = ['accountKey', 'kind', 'meetingTime', 'skill', 'crmAsOf', 'generatedAt'];

function resolveStore(options) {
  if (options && options.store) return options.store;
  return require('./state-store').createStateStoreSync();
}

function closeIfOwned(store, options) {
  if (!(options && options.store) && store && typeof store.close === 'function') store.close();
}

function nowIso(options) {
  return (options && options.now) || new Date().toISOString();
}

function labelFor(kind) {
  return String(kind || 'prep').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Deterministic id so re-running the sweep the same day upserts, not duplicates. */
function preparedId(accountKey, kind, meetingTime, generatedAt) {
  const slot = meetingTime || String(generatedAt).slice(0, 10);
  return `mp:${accountKey}:${kind || 'prep'}:${slot}`;
}

/**
 * Stage (or refresh) one prepared-day item. Resolves the account canonically
 * (ADR-0018) and stores only whitelisted structured fields.
 * @param {{account:string, kind?:string, meetingTime?:string, skill?:string, crmAsOf?:string, generatedAt?:string}} input
 * @param {{store?:object, now?:string}} [options]
 * @returns {object} the stored prepared item (clean shape)
 */
function addPreparedItem(input = {}, options = {}) {
  const accountKey = identity.accountKey(input.account);
  if (!accountKey) throw new TypeError(`worklist-store: unusable account id: ${input.account}`);
  const generatedAt = input.generatedAt || nowIso(options);
  const kind = input.kind || 'prep';
  const meetingTime = input.meetingTime || null;
  const metadata = {
    accountKey,
    kind,
    meetingTime,
    skill: input.skill || null,
    crmAsOf: input.crmAsOf || 'no-crm-read',
    generatedAt,
  };
  const title = `${labelFor(kind)} — ${accountKey}${meetingTime ? ` @ ${meetingTime}` : ''}`;

  const store = resolveStore(options);
  try {
    store.upsertWorkItem({
      id: preparedId(accountKey, kind, meetingTime, generatedAt),
      source: MORNING_PREP_SOURCE,
      sourceId: accountKey,
      title,
      status: 'open',
      metadata,
    });
  } finally {
    closeIfOwned(store, options);
  }
  return { id: preparedId(accountKey, kind, meetingTime, generatedAt), accountKey, kind, meetingTime, title, status: 'open', ...metadata };
}

function toClean(item) {
  const m = (item && item.metadata) || {};
  return {
    id: item.id,
    accountKey: m.accountKey || item.sourceId || null,
    kind: m.kind || null,
    meetingTime: m.meetingTime || null,
    skill: m.skill || null,
    crmAsOf: m.crmAsOf || null,
    generatedAt: m.generatedAt || null,
    status: item.status,
    title: item.title,
  };
}

/**
 * List prepared-day items (source:'morning-prep'), newest first.
 * @param {{status?:string}} [filter] e.g. {status:'open'}
 * @param {{store?:object}} [options]
 * @returns {object[]} clean prepared items
 */
function listPreparedItems(filter = {}, options = {}) {
  const store = resolveStore(options);
  try {
    const { items } = store.listWorkItems({ limit: 500 });
    return items
      .filter(i => i.source === MORNING_PREP_SOURCE)
      .filter(i => (filter.status ? i.status === filter.status : true))
      .map(toClean);
  } finally {
    closeIfOwned(store, options);
  }
}

/** Mark a prepared item done (status:'done'), preserving its structured fields. */
function markPreparedDone(id, options = {}) {
  const store = resolveStore(options);
  try {
    const { items } = store.listWorkItems({ limit: 500 });
    const item = items.find(i => i.id === id && i.source === MORNING_PREP_SOURCE);
    if (!item) return { updated: false, id };
    store.upsertWorkItem({
      id: item.id,
      source: MORNING_PREP_SOURCE,
      sourceId: item.sourceId,
      title: item.title,
      status: 'done',
      metadata: item.metadata || null,
    });
    return { updated: true, id };
  } finally {
    closeIfOwned(store, options);
  }
}

function formatList(items) {
  if (!items.length) return 'No prepared items.';
  return items.map(i => `  [${i.status}] ${i.title}${i.crmAsOf ? ` (CRM ${i.crmAsOf})` : ''}`).join('\n');
}

/**
 * CLI wrapper for `escc worklist <add|list|done>`. @returns {{code,text,data}}
 */
function runWorklist(positional = [], flags = {}) {
  const action = positional[0] || 'list';
  try {
    if (action === 'add') {
      if (!flags.account) return { code: 1, text: 'worklist add requires --account <id>.', data: null };
      const item = addPreparedItem({
        account: flags.account,
        kind: flags.kind,
        meetingTime: flags.meeting || flags.meetingTime,
        skill: flags.skill,
        crmAsOf: flags.crmAsOf || flags.crmAsof,
      });
      return { code: 0, text: `Staged: ${item.title}`, data: item };
    }
    if (action === 'done') {
      const id = positional[1] || flags.id;
      if (!id) return { code: 1, text: 'worklist done requires an item id.', data: null };
      const res = markPreparedDone(id);
      return { code: res.updated ? 0 : 1, text: res.updated ? `Done: ${id}` : `No prepared item: ${id}`, data: res };
    }
    if (action === 'list') {
      const items = listPreparedItems(flags.all ? {} : { status: 'open' });
      return { code: 0, text: formatList(items), data: items };
    }
    return { code: 1, text: `Unknown worklist action: ${action} (use add|list|done).`, data: null };
  } catch (err) {
    return { code: 1, text: `worklist ${action} failed: ${err.message}`, data: null };
  }
}

module.exports = {
  MORNING_PREP_SOURCE,
  META_KEYS,
  addPreparedItem,
  listPreparedItems,
  markPreparedDone,
  runWorklist,
  preparedId,
};
