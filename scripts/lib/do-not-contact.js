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
  const notBefore = new Date(row.not_before);
  // Fail closed: an unparseable not-before must read as STILL BLOCKED, never
  // as expired — a garbled date would otherwise silently disarm a suppression.
  if (Number.isNaN(notBefore.getTime())) return row;
  return notBefore > now ? row : null;
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

// --- CLI: `escc dnc <record|check|list|clear>` (v1.10.0) ---------------------
//
// The blessed write path that makes an inbound opt-out HOOK-ENFORCED: rows
// written here are what the fail-closed send-gate consults on every gated
// outbound. A CRM-side suppression flag (crm-operator) does NOT gate sends —
// only this store does — so opt-out-handling runs `escc dnc record` FIRST.

/** Resolve the key exactly the way the send-gate will read it. */
function resolveDncKey(rawKey, scope) {
  const key = normalizeContactKey(rawKey);
  if (!key) return { error: 'a contact email or account id is required (--key <email|domain|company:id>)' };
  if (scope === 'account') {
    // Same ADR-0018 canonical resolution the gate re-derives from a recipient.
    const identity = require('./account-identity');
    const canonical = identity.accountKey(key);
    if (!canonical) return { error: `could not resolve "${rawKey}" to a canonical account key` };
    return { key: canonical };
  }
  // A contact-scope row only ever matches an email recipient; a bare domain
  // here would LOOK suppressed while gating nothing.
  if (!key.includes('@')) {
    return { error: `"${rawKey}" is not an email address — for a whole company use --scope account` };
  }
  return { key };
}

function formatDncRow(r) {
  const state = r.cleared ? 'cleared' : (r.not_before ? `blocked until ${String(r.not_before).slice(0, 10)}` : 'blocked indefinitely');
  return `  [${r.scope}] ${r.key} — ${state} — ${r.reason}`;
}

/**
 * CLI wrapper for `escc dnc`. @returns {{code:number, text:string, data:*}}
 */
function runDnc(positional = [], flags = {}) {
  const action = positional[0] || 'list';
  const rawKey = flags.key || positional[1];
  const asJson = (obj) => JSON.stringify(obj, null, 2);
  try {
    if (action === 'record') {
      const scope = flags.scope === 'account' ? 'account' : 'contact';
      const resolved = resolveDncKey(rawKey, scope);
      if (resolved.error) return { code: 1, text: `dnc record: ${resolved.error}`, data: null };
      if (flags.notBefore && Number.isNaN(new Date(flags.notBefore).getTime())) {
        return { code: 1, text: `dnc record: --not-before "${flags.notBefore}" is not a parseable date — use ISO form (e.g. 2026-09-01). Omit it for an indefinite block.`, data: null };
      }
      const reason = flags.source
        ? `${flags.reason || 'do-not-contact'} [via ${flags.source}]`
        : (flags.reason || 'do-not-contact');
      const row = recordDoNotContact({
        key: resolved.key,
        scope,
        reason,
        notBefore: flags.notBefore || null,
        sessionId: process.env.CLAUDE_SESSION_ID || null,
      });
      const reach = scope === 'account'
        ? `every contact at ${row.key}`
        : row.key;
      const text = `Recorded: the send-gate now blocks all gated outbound to ${reach}${row.not_before ? ` until ${String(row.not_before).slice(0, 10)}` : ' (indefinite)'}.`;
      return { code: 0, text: flags.json ? asJson(row) : text, data: row };
    }
    if (action === 'check') {
      const key = normalizeContactKey(rawKey);
      if (!key) return { code: 1, text: 'dnc check requires a contact email or account id (--key).', data: null };
      // Mirror the gate: the contact key, then the derived account key.
      const keysToCheck = [key];
      if (key.includes('@')) {
        try {
          const acct = require('./account-identity').accountKey(key);
          if (acct && acct !== key) keysToCheck.push(acct);
        } catch (_e) { /* identity resolution is best-effort, as in the gate */ }
      }
      for (const k of keysToCheck) {
        const blocked = findActiveBlock({ key: k });
        if (blocked) {
          const who = k === key ? 'contact' : 'account';
          const text = `BLOCKED (${who}-scope): ${formatDncRow(blocked).trim()}`;
          return { code: 0, text: flags.json ? asJson({ blocked: true, row: blocked }) : text, data: { blocked: true, row: blocked } };
        }
      }
      return { code: 0, text: flags.json ? asJson({ blocked: false, row: null }) : `Not blocked: ${key} has no active do-not-contact entry.`, data: { blocked: false, row: null } };
    }
    if (action === 'list') {
      const rows = listDoNotContact();
      const text = rows.length ? `Do-not-contact (${rows.length}):\n${rows.map(formatDncRow).join('\n')}` : 'Do-not-contact list is empty.';
      return { code: 0, text: flags.json ? asJson(rows) : text, data: rows };
    }
    if (action === 'clear') {
      const scope = flags.scope === 'account' ? 'account' : 'contact';
      const resolved = resolveDncKey(rawKey, scope);
      if (resolved.error) return { code: 1, text: `dnc clear: ${resolved.error}`, data: null };
      if (!flags.evidence) {
        return { code: 1, text: 'dnc clear: refusing without --evidence "<documented re-consent>" — lifting a suppression is a compliance action and must carry provenance.', data: null };
      }
      const row = clearDoNotContact({
        key: resolved.key,
        scope,
        reason: `re-consent: ${flags.evidence}`,
        sessionId: process.env.CLAUDE_SESSION_ID || null,
      });
      const text = `Cleared: ${row.key} may be contacted again. The clear is audited with your evidence; fresh outreach still goes through the full review path.`;
      return { code: 0, text: flags.json ? asJson(row) : text, data: row };
    }
    return { code: 1, text: `Unknown dnc action: ${action} (use record|check|list|clear).`, data: null };
  } catch (err) {
    return { code: 1, text: `dnc ${action} failed: ${err.message}`, data: null };
  }
}

module.exports = {
  normalizeContactKey,
  recordDoNotContact,
  findActiveBlock,
  listDoNotContact,
  clearDoNotContact,
  runDnc,
};
