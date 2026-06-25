/*
 * ESCC product-knowledge candidate miner (NEW for ESCC; ADR-0012).
 *
 * Mines a small seed of CANDIDATES from untrusted field content (call transcripts,
 * sent-email history) for human review. Hard rules, by construction:
 *   - it only ever emits CANDIDATES (approved:false + untrusted:true, forced by
 *     product-knowledge.appendCandidate) — it NEVER approves anything;
 *   - it does NOT infer a response, a metric, or a customer name — it flags the
 *     observed pattern only, leaving the approved response to a human operator;
 *   - it writes to the operator-only candidate area, never a drafting context.
 *
 * The actual extraction of raw untrusted text runs inside the repo's quarantine
 * pattern (the transcript-analyzer / quarantine subagent), whose structured output
 * is ingested here. extractObjectionCandidates() is a conservative, deterministic
 * (no-LLM) cue matcher for the seed; ingestCandidates() takes an already-extracted
 * batch. The ongoing outcome-fed loop is DEFERRED (ADR-0012) — this is seeding only.
 */

'use strict';

const { appendCandidate } = require('./product-knowledge');

// Conservative cue patterns that commonly signal an objection in field text.
// Deliberately high-precision: a miss is fine (a human adds it later); a false
// approval is not possible (everything here is a candidate only).
const OBJECTION_CUES = [
  /\bwe (?:already|currently) (?:have|use|run)\b/i,
  /\btoo (?:expensive|costly|pricey|much)\b/i,
  /\bnot (?:right now|a priority|the right time|in the budget)\b/i,
  /\bhappy with (?:our|the|my) (?:current|existing)\b/i,
  /\bno budget\b/i,
  /\bcall me back (?:next|in|after)\b/i,
  /\bsend me (?:some )?(?:info|information|a deck|details)\b/i,
  /\blocked in (?:a |our )?contract\b/i,
];

/** Split text into rough sentences/lines for cue scanning. */
function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Deterministically FLAG candidate objections in untrusted call/email text.
 * Conservative: it flags cue-matched sentences only, never infers a response.
 * @returns {object[]} candidate objection structs (not yet written)
 */
function extractObjectionCandidates(text, opts = {}) {
  const out = [];
  for (const s of sentences(text)) {
    if (OBJECTION_CUES.some(re => re.test(s))) {
      out.push({
        type: 'objection',
        pattern: s.slice(0, 280),
        response: '(candidate — operator must draft + approve the rebuttal)',
        source_type: opts.sourceType || 'call',
        source_ref: opts.sourceRef || null,
      });
    }
  }
  return out;
}

/**
 * Ingest a batch of candidate structs (e.g. from the quarantine subagent) into the
 * operator-only candidate area. appendCandidate FORCES approved:false +
 * untrusted:true, so nothing here can ever be approved or trusted.
 * @returns {object[]} the stored candidate rows
 */
function ingestCandidates(items, opts = {}) {
  const stored = [];
  for (const item of items || []) {
    stored.push(appendCandidate({
      source_type: item.source_type || opts.sourceType || 'manual',
      source_ref: item.source_ref || opts.sourceRef || null,
      ...item,
    }, opts));
  }
  return stored;
}

module.exports = { extractObjectionCandidates, ingestCandidates, sentences, OBJECTION_CUES };
