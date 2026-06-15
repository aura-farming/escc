/*
 * ESCC promise-extract (NEW for ESCC).
 *
 * Detects rep COMMITMENTS in plain conversation text — "I'll follow up next
 * week", "I will send the MSA by 2026-06-20" — and turns each into a first-class
 * promise record (A.2 C3) so they can be persisted to the state-store `promises`
 * table at session end and surfaced by follow-through-check across sessions.
 *
 * Pure + deterministic: relative due dates ("tomorrow", "Friday", "next week")
 * resolve against an injected `now`, and the record id is a stable hash of
 * (account_id + normalized text) so repeated SessionEnd runs upsert idempotently
 * and the SAME promise for different accounts gets distinct ids (multi-account
 * attribution, C8).
 *
 * Untrusted-content note (A.3 I3 spirit): callers pass the rep's own conversation
 * text. This module never executes anything it reads — it only quotes/labels it.
 */

'use strict';

const crypto = require('crypto');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_PROMISE_TEXT = 200;

// A sentence is a commitment when it contains one of these markers. Kept close
// to ECC's evaluate-session followUpsPromised heuristic, broadened for sales.
const COMMITMENT_MARKERS = [
  /\bi['’]?ll\b/i,
  /\bi will\b/i,
  /\bwe['’]?ll\b/i,
  /\bwe will\b/i,
  /\bpromised to\b/i,
  /\bi'?m going to\b/i,
  /\blet me (?:send|follow up|get|put together|share)\b/i,
];

// Verbs that make a commitment a real deliverable (filters out "I'll think about it").
const COMMITMENT_VERBS = /\b(follow(?:[- ]?up)?|send|share|circle back|get back|put together|draft|schedule|book|forward|loop in|introduce|reach out|provide|prepare|email|call)\b/i;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function toMs(value) {
  if (value === undefined || value === null) return Date.now();
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? Date.now() : t;
}

function toIsoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Resolve a due date from a commitment sentence, relative to `nowMs`.
 * Handles: explicit ISO dates, today/EOD, tomorrow, next week, end of week,
 * and weekday names (next occurrence). Returns null when no date is implied.
 * @param {string} sentence
 * @param {number} nowMs
 * @returns {string|null} ISO yyyy-mm-dd or null
 */
function resolveDueDate(sentence, nowMs) {
  const s = String(sentence).toLowerCase();

  const iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) {
    const d = new Date(`${iso[1]}T00:00:00Z`);
    // Reject structurally-valid but impossible dates (e.g. 2026-13-45) so a bad
    // due_date never reaches the store and renders as "NaN day(s) overdue".
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso[1]) return iso[1];
  }

  if (/\b(tomorrow)\b/.test(s)) return toIsoDate(nowMs + MS_PER_DAY);
  if (/\b(today|eod|end of (?:the )?day)\b/.test(s)) return toIsoDate(nowMs);
  if (/\bnext week\b/.test(s)) return toIsoDate(nowMs + 7 * MS_PER_DAY);
  if (/\b(end of (?:the )?week|this week)\b/.test(s)) {
    // Friday of the current week.
    const dow = new Date(nowMs).getUTCDay();
    const delta = (5 - dow + 7) % 7;
    return toIsoDate(nowMs + delta * MS_PER_DAY);
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    const re = new RegExp(`\\b(?:by |on |this |next )?${WEEKDAYS[i]}\\b`);
    if (re.test(s)) {
      const dow = new Date(nowMs).getUTCDay();
      let delta = (i - dow + 7) % 7;
      if (delta === 0) delta = 7; // a named weekday means the NEXT one, not today
      return toIsoDate(nowMs + delta * MS_PER_DAY);
    }
  }
  return null;
}

/** Normalize promise text for stable hashing/dedup (lowercase, collapse ws). */
function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Stable, account-scoped promise id. */
function promiseId(text, accountId) {
  const key = `${accountId || 'global'}|${normalizeText(text)}`;
  return `promise-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}

/** Split text into candidate sentences (sentence punctuation + newlines). */
function splitSentences(text) {
  return String(text || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function isCommitment(sentence) {
  if (!COMMITMENT_VERBS.test(sentence)) return false;
  return COMMITMENT_MARKERS.some(re => re.test(sentence));
}

/**
 * Reduce a sentence to its commitment clause: the substring starting at the
 * earliest commitment marker. Drops preamble ("Later: ", "So ") so the stored
 * promise reads cleanly and identical commitments dedupe regardless of preamble.
 * @param {string} sentence
 * @returns {string}
 */
function commitmentClause(sentence) {
  let start = -1;
  for (const re of COMMITMENT_MARKERS) {
    const m = sentence.match(re);
    if (m && typeof m.index === 'number' && (start === -1 || m.index < start)) {
      start = m.index;
    }
  }
  return start > 0 ? sentence.slice(start) : sentence;
}

/**
 * Extract promise records from plain conversation text.
 * @param {string} text already-extracted conversation text (not raw JSONL)
 * @param {{now?: string|number, accountId?: string, dealId?: string, sessionId?: string}} [ctx]
 * @returns {Array<{id, account_id, deal_id, text, due_date, status, source_session}>}
 */
function extractPromises(text, ctx = {}) {
  const nowMs = toMs(ctx.now);
  const accountId = ctx.accountId ?? null;
  const dealId = ctx.dealId ?? null;
  const sessionId = ctx.sessionId ?? null;

  const seen = new Set();
  const promises = [];
  for (const sentence of splitSentences(text)) {
    if (!isCommitment(sentence)) continue;
    const clean = commitmentClause(sentence).replace(/\s+/g, ' ').trim().slice(0, MAX_PROMISE_TEXT);
    const norm = normalizeText(clean);
    if (seen.has(norm)) continue;
    seen.add(norm);
    promises.push({
      id: promiseId(clean, accountId),
      account_id: accountId,
      deal_id: dealId,
      text: clean,
      due_date: resolveDueDate(sentence, nowMs),
      status: 'open',
      source_session: sessionId,
    });
  }
  return promises;
}

module.exports = {
  extractPromises,
  resolveDueDate,
  promiseId,
  normalizeText,
  splitSentences,
  isCommitment,
};
