/*
 * ESCC account-memory (NEW for ESCC; concept adapted from ECC knowledge-ops).
 *
 * The canonical per-entity (account/deal) memory store — A.2 C1/C5 of the ESCC
 * design. HubSpot is the system of record; account-memory is the durable
 * WORKING context that survives across sessions and months: tagged events
 * appended to a per-account JSONL log, with a folded digest used to hydrate the
 * ACTIVE deal at session start and a markdown companion that doubles as the
 * SDR->AE->CS handoff payload (C5).
 *
 * Storage: <ESCC_AGENT_DATA_HOME>/escc/accounts/<sanitized-id>.{jsonl,md}
 *   - <id>.jsonl : append-only tagged event log (canonical)
 *   - <id>.md    : rendered handoff view, refreshed on every append
 *
 * Pure synchronous module: the lifecycle hooks (session-start/end, sla-check)
 * call into it inside the synchronous run(raw, ctx) contract.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { resolveAgentDataHome } = require('./agent-data-home');
const { atomicWriteFile } = require('./utils');
const identity = require('./account-identity');

const ACCOUNTS_SUBDIR = path.join('escc', 'accounts');
const MAX_ID_LENGTH = 80;
const DEFAULT_RECENT = 8;
const DEFAULT_DIGEST_MAX_CHARS = 1600;

// Statuses that mark a loop/deal as no longer open.
const CLOSED_STATUSES = new Set(['done', 'closed', 'cancelled', 'won', 'lost', 'resolved']);
// Event types that represent an open commitment / unresolved loop.
const LOOP_TYPES = new Set(['loop', 'promise', 'inbound', 'follow_up', 'next_step']);

/**
 * Map an arbitrary account identifier to a safe filename stem. Now owned by
 * scripts/lib/account-identity.js (ADR-0018) and re-exported here for the
 * existing callers; identity is the leaf module so no require cycle forms.
 * @param {string} raw
 * @returns {string|null} safe stem, or null if unusable
 */
const sanitizeAccountId = identity.sanitizeStem;

/** Absolute path to the accounts directory under the agent data home. */
function resolveAccountsDir(options = {}) {
  return path.join(resolveAgentDataHome(options), ACCOUNTS_SUBDIR);
}

/**
 * The CANONICAL stem for an account id (ADR-0018): alias index first, then
 * grammar canonicalization — so "Example Co" (once linked), "acme.example", and
 * "company:<hubspot-id>" all land in ONE store.
 */
function canonicalStem(accountId) {
  return identity.accountKey(accountId);
}

/** Absolute path to an account's JSONL event log (throws on unusable id). */
function accountFile(accountId, options = {}) {
  const stem = canonicalStem(accountId);
  if (!stem) throw new TypeError(`account-memory: unusable account id: ${accountId}`);
  return path.join(resolveAccountsDir(options), `${stem}.jsonl`);
}

/** Absolute path to an account's markdown handoff view. */
function markdownFile(accountId, options = {}) {
  const stem = canonicalStem(accountId);
  if (!stem) throw new TypeError(`account-memory: unusable account id: ${accountId}`);
  return path.join(resolveAccountsDir(options), `${stem}.md`);
}

/**
 * Append a tagged event to an account's memory log and refresh its markdown
 * view. Fills `id`, `ts`, and `account_id` (original, unsanitized) when absent.
 * @param {string} accountId original account identifier
 * @param {object} event { type, text?, deal_id?, session_id?, status?, due_date?,
 *   segment?, close_date?, stage?, amount?, name?, tags?, source?, ts?, id? }
 * @returns {object} the stored event
 */
function appendEvent(accountId, event, options = {}) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('account-memory.appendEvent: event must be an object');
  }
  const filePath = accountFile(accountId, options); // throws on bad id
  const stored = {
    id: event.id || `ev-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
    ts: event.ts || new Date().toISOString(),
    type: event.type || 'note',
    account_id: event.account_id || accountId,
    ...event,
  };
  // Keep id/ts/type/account_id authoritative even if event supplied partials.
  stored.id = event.id || stored.id;
  stored.ts = event.ts || stored.ts;
  stored.account_id = event.account_id || accountId;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(stored)}\n`);

  // Refresh the markdown handoff companion (best-effort; never throws upward
  // for a render failure — the JSONL log is the canonical record).
  try {
    writeMarkdownView(accountId, options);
  } catch (_err) {
    /* canonical log already written; md view is a convenience */
  }
  return stored;
}

/**
 * Read an account's events oldest-first. Tolerates a missing file ([]) and
 * skips blank/corrupt lines (a torn final write never breaks a read).
 * @param {string} accountId
 * @returns {object[]}
 */
function readEvents(accountId, options = {}) {
  let filePath;
  try {
    filePath = accountFile(accountId, options);
  } catch (_err) {
    return [];
  }
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const events = [];
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (_err) {
      /* skip a torn/corrupt line */
    }
  }
  return events;
}

function isClosed(status) {
  return CLOSED_STATUSES.has(String(status || '').toLowerCase());
}

/**
 * Fold an account's event log into a working digest.
 * @returns {{accountId, segment, deals, openLoops, recent, eventCount, lastEventAt}}
 */
function hydrate(accountId, options = {}) {
  const events = readEvents(accountId, options);
  const recentLimit = Number.isInteger(options.recent) ? options.recent : DEFAULT_RECENT;

  let segment = null;
  let originalId = null;
  let lastEventAt = null;
  const deals = {};
  const openLoops = [];
  // Track open loop keys so a later closing event removes an earlier open one.
  const loopIndexById = new Map();

  for (const ev of events) {
    if (ev.account_id && !originalId) originalId = ev.account_id;
    if (ev.segment) segment = ev.segment;
    if (ev.ts && (!lastEventAt || ev.ts > lastEventAt)) lastEventAt = ev.ts;

    // Deal folding: any event carrying a deal_id contributes the latest
    // non-null deal fields.
    if (ev.deal_id) {
      const d = deals[ev.deal_id] || { deal_id: ev.deal_id, account_id: ev.account_id || accountId };
      for (const field of ['close_date', 'stage', 'amount', 'name', 'status']) {
        if (ev[field] !== undefined && ev[field] !== null) d[field] = ev[field];
      }
      deals[ev.deal_id] = d;
    }

    // A closing event of ANY type carrying an id that matches a tracked loop
    // resolves that loop — so a `{ id, status:'done' }` marker (a note, a CRM
    // sync event, anything) clears a promise/loop, not only loop-typed events.
    if (ev.id && isClosed(ev.status) && loopIndexById.has(ev.id)) {
      openLoops[loopIndexById.get(ev.id)] = null;
      loopIndexById.delete(ev.id);
    }

    // Open-loop folding: a loop-type event opens a loop; a later event with the
    // same id (or a closing status) resolves it.
    if (LOOP_TYPES.has(String(ev.type))) {
      const key = ev.id || `${ev.type}:${ev.text || ''}`;
      if (isClosed(ev.status)) {
        if (loopIndexById.has(key)) {
          openLoops[loopIndexById.get(key)] = null;
          loopIndexById.delete(key);
        }
      } else {
        const entry = {
          id: ev.id,
          type: ev.type,
          text: ev.text || '',
          deal_id: ev.deal_id || null,
          due_date: ev.due_date || null,
          ts: ev.ts || null,
        };
        if (loopIndexById.has(key)) {
          openLoops[loopIndexById.get(key)] = entry;
        } else {
          loopIndexById.set(key, openLoops.length);
          openLoops.push(entry);
        }
      }
    }
  }

  const recent = events
    .slice()
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
    .slice(0, recentLimit);

  return {
    accountId: originalId || accountId,
    segment,
    deals,
    openLoops: openLoops.filter(Boolean),
    recent,
    eventCount: events.length,
    lastEventAt,
  };
}

/** Short label for an event line in the digest. */
function eventLine(ev) {
  const day = String(ev.ts || '').slice(0, 10);
  const text = String(ev.text || ev.type || '').replace(/\s+/g, ' ').trim();
  const dealTag = ev.deal_id ? ` (deal ${ev.deal_id})` : '';
  return `- ${day ? `${day} ` : ''}[${ev.type}]${dealTag} ${text}`.trimEnd();
}

// Open loops older than this many days are flagged "stale — reverify" in the
// digest (ADR-0018: a months-old loop must never inject as if current). They
// are NEVER dropped — a real open promise must not silently vanish.
const DEFAULT_LOOP_STALE_DAYS = 21;

function loopStaleDays() {
  const n = Number.parseInt(String(process.env.ESCC_LOOP_STALE_DAYS ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LOOP_STALE_DAYS;
}

function isStaleLoop(loop, nowMs, staleDays) {
  if (!loop || !loop.ts) return false; // no timestamp -> cannot age; show as live
  const t = Date.parse(loop.ts);
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleDays * 24 * 60 * 60 * 1000;
}

/**
 * Render a hydrated digest into markdown, capped to `maxChars` (hard cap that
 * never overruns; lower-value lines drop first).
 * @param {object} hydrated result of hydrate()
 * @param {number} [maxChars]
 * @param {{now?: string|number}} [options] injectable clock for tests
 * @returns {string}
 */
function renderDigest(hydrated, maxChars = DEFAULT_DIGEST_MAX_CHARS, options = {}) {
  if (!hydrated) return '';
  const header = `Account memory — ${hydrated.accountId}${hydrated.segment ? ` · segment: ${hydrated.segment}` : ''}:`;
  const lines = [header];

  if (hydrated.openLoops && hydrated.openLoops.length) {
    const staleDays = loopStaleDays();
    const nowMs = toMs(options.now);
    const live = [];
    const stale = [];
    for (const loop of hydrated.openLoops) {
      (isStaleLoop(loop, nowMs, staleDays) ? stale : live).push(loop);
    }
    const loopLine = loop => {
      const due = loop.due_date ? ` (due ${loop.due_date})` : '';
      return `- ${loop.text || loop.type}${due}`;
    };
    if (live.length) {
      lines.push('Open loops:');
      for (const loop of live) lines.push(loopLine(loop));
    }
    if (stale.length) {
      lines.push(`Stale open loops (>${staleDays}d old — reverify before acting):`);
      for (const loop of stale) lines.push(loopLine(loop));
    }
  }

  const nearDeals = Object.values(hydrated.deals || {}).filter(d => d.close_date);
  if (nearDeals.length) {
    lines.push('Deals:');
    for (const d of nearDeals) {
      lines.push(`- ${d.name || d.deal_id}${d.stage ? ` [${d.stage}]` : ''} — close ${d.close_date}`);
    }
  }

  if (hydrated.recent && hydrated.recent.length) {
    lines.push('Recent activity:');
    for (const ev of hydrated.recent) lines.push(eventLine(ev));
  }

  let out = lines.join('\n');
  if (maxChars >= 0 && out.length > maxChars) {
    // Strip a trailing lone surrogate so a cut mid surrogate-pair (emoji,
    // non-Latin names) never injects an invalid character into the handoff view.
    const cut = out.slice(0, Math.max(0, maxChars - 1)).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
    out = `${cut}…`.slice(0, maxChars);
  }
  return out;
}

/** Write/refresh the markdown handoff companion view for an account. */
function writeMarkdownView(accountId, options = {}) {
  const md = markdownFile(accountId, options);
  const hydrated = hydrate(accountId, { ...options, recent: 50 });
  const body = renderDigest(hydrated, Number.MAX_SAFE_INTEGER);
  // Atomic write (tmp + rename) so a concurrent same-account append never sees a
  // half-written handoff (.md) view; the JSONL log remains the canonical record.
  atomicWriteFile(md, `# Account memory: ${hydrated.accountId}\n\n${body}\n`);
  return md;
}

/**
 * Resolve the ACTIVE account/deal to hydrate at session start (C1).
 * Priority: ESCC_ACTIVE_ACCOUNT override > most-recently-modified account file.
 * Returns null when no account memory exists yet.
 * @returns {{accountId, dealId, segment}|null}
 */
function resolveActiveAccount(options = {}) {
  const override = (process.env.ESCC_ACTIVE_ACCOUNT || '').trim();
  if (override) {
    const h = hydrate(override, options);
    return { accountId: h.accountId, dealId: pickPrimaryDealId(h), segment: h.segment };
  }

  const dir = resolveAccountsDir(options);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return null;
  }
  let newest = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(dir, entry.name)).mtimeMs;
    } catch (_err) {
      continue;
    }
    if (!newest || mtime > newest.mtime) {
      newest = { stem: entry.name.replace(/\.jsonl$/, ''), mtime };
    }
  }
  if (!newest) return null;

  const h = hydrate(newest.stem, options);
  return { accountId: h.accountId, dealId: pickPrimaryDealId(h), segment: h.segment };
}

/** Pick the most relevant deal id from a hydrated digest (open loop deal first). */
function pickPrimaryDealId(hydrated) {
  if (!hydrated) return null;
  const loopDeal = (hydrated.openLoops || []).find(l => l.deal_id);
  if (loopDeal) return loopDeal.deal_id;
  const dealIds = Object.keys(hydrated.deals || {});
  return dealIds.length ? dealIds[0] : null;
}

/** Coerce a date input (ISO string or ms) to epoch ms; NaN-safe. */
function toMs(value) {
  if (value === undefined || value === null) return Date.now();
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? Date.now() : t;
}

/**
 * Scan ALL account memory for deals whose close_date falls within
 * [now, now + withinDays], excluding closed/won/lost (C2 imminent-close).
 * @param {number} withinDays
 * @param {{now?: string|number}} [options]
 * @returns {Array<{account_id, deal_id, name, close_date, stage, amount, status}>}
 */
function listNearCloseDeals(withinDays = 14, options = {}) {
  const dir = resolveAccountsDir(options);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return [];
  }
  const nowMs = toMs(options.now);
  const horizonMs = nowMs + Math.max(0, withinDays) * 24 * 60 * 60 * 1000;

  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const stem = entry.name.replace(/\.jsonl$/, '');
    const h = hydrate(stem, options);
    for (const deal of Object.values(h.deals)) {
      if (!deal.close_date || isClosed(deal.status)) continue;
      const closeMs = Date.parse(deal.close_date);
      if (Number.isNaN(closeMs)) continue;
      if (closeMs >= nowMs - 24 * 60 * 60 * 1000 && closeMs <= horizonMs) {
        out.push({ ...deal });
      }
    }
  }
  out.sort((a, b) => String(a.close_date).localeCompare(String(b.close_date)));
  return out;
}

module.exports = {
  sanitizeAccountId,
  resolveAccountsDir,
  accountFile,
  markdownFile,
  appendEvent,
  readEvents,
  hydrate,
  renderDigest,
  writeMarkdownView,
  resolveActiveAccount,
  listNearCloseDeals,
  pickPrimaryDealId,
  loopStaleDays,
  DEFAULT_LOOP_STALE_DAYS,
  CLOSED_STATUSES,
  LOOP_TYPES,
};
