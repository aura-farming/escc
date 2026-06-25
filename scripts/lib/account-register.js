/*
 * ESCC per-account register extractor (NEW for ESCC; ADR-0015).
 *
 * Deterministic, no-ML, no-dependency reader of the BUYER side of prior
 * correspondence for one account. It computes a STYLE register — how this
 * account writes — so a draft can mirror their register and vocabulary on top
 * of the rep's base [VOICE PROFILE]. It is the per-account analogue of the
 * rep-level brand-voice profile.
 *
 * Hard rule, by construction (the style/content split, ADR-0013): this module
 * extracts STYLE only. The lexicon it surfaces is the buyer's recurring WORDS —
 * pure-alphabetic terms with stopwords removed — so a number, a percentage, a
 * currency figure, or any other CLAIM can NEVER enter it (a token only survives
 * if it matches /^[a-z][a-z'-]*$/, which no digit-bearing string does). FACTS
 * and metrics come only from approved product-knowledge, never from here.
 *
 * Pure: extractRegister(input, opts) reads no disk and has no side effects — it
 * takes the buyer text (the caller gathers it via the quarantine/thread path).
 * Storage + rendering live in scripts/lib/voice-overlay.js.
 */

'use strict';

// Sentence splitter mirrors scripts/lib/product-mine.js sentences() (kept local
// so this stays a dependency-free leaf module — no candidate-miner coupling).
function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Alphabetic word tokens only — digits/punctuation never start or join a token. */
function words(text) {
  return String(text || '').match(/[a-zA-Z][a-zA-Z'-]*/g) || [];
}

// High-precision register cues. A miss is fine; over-claiming formality is not.
const FORMAL_CUES = [
  /\bdear\b/i, /\bsincerely\b/i, /\b(?:kind|warm|best) regards\b/i, /\bregards\b/i,
  /\bto whom it may concern\b/i, /\bplease find\b/i, /\bplease do not hesitate\b/i,
  /\bi would be\b/i, /\bwe would be\b/i, /\bfurthermore\b/i, /\byours (?:sincerely|faithfully|truly)\b/i,
  /\bthank you\b/i,
];
const CASUAL_CUES = [
  /\bhey\b/i, /\bhi\b/i, /\bthx\b/i, /\bcheers\b/i, /\bno worries\b/i,
  /\byeah\b/i, /\bgonna\b/i, /\bwanna\b/i, /\blol\b/i, /\bawesome\b/i,
  /\b(?:i'm|we're|don't|can't|won't|it's|that's|let's|i'll|we'll|you're|doesn't|isn't|we've|i've)\b/i,
  /!/,
  // common emoji ranges
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
];

const GREETINGS = ['good morning', 'good afternoon', 'good evening', 'hello', 'hey', 'hi', 'dear', 'greetings'];
const SIGN_OFFS = [
  'kind regards', 'warm regards', 'best regards', 'best wishes', 'many thanks',
  'thank you', 'thanks', 'regards', 'cheers', 'sincerely', 'best', 'talk soon', 'speak soon',
];

// Closed-class words + ubiquitous sales filler that carry no per-account signal.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'so', 'as', 'of', 'to', 'in', 'on',
  'at', 'by', 'for', 'with', 'about', 'into', 'over', 'after', 'before', 'from', 'up', 'down', 'out',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'us', 'our', 'ours', 'you', 'your',
  'yours', 'i', 'me', 'my', 'mine', 'they', 'them', 'their', 'he', 'she', 'his', 'her', 'who', 'whom',
  'which', 'what', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
  'there', 'here', 'now', 'get', 'got', 'one', 'two', 'like', 'want', 'need', 'make', 'made', 'thanks',
  'thank', 'hi', 'hey', 'hello', 'dear', 'regards', 'best', 'cheers', 'team', 'let', 'know', 'please',
]);

function countMatches(texts, cues) {
  let hits = 0;
  for (const t of texts) {
    for (const re of cues) if (re.test(t)) hits += 1;
  }
  return hits;
}

/**
 * Find the most common leading greeting / trailing sign-off across the texts.
 * 'start' anchors to the message head; 'end' matches anywhere in a short tail
 * window so a sign-off followed by a name ("Regards, Morgan") is still caught.
 * Phrases are listed specific-first so the longest match wins per message.
 */
function detectEdge(texts, phrases, where) {
  const tally = new Map();
  for (const t of texts) {
    const flat = String(t).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!flat) continue;
    const window = where === 'start' ? flat.slice(0, 24) : flat.slice(-40);
    for (const p of phrases) {
      const re = where === 'start' ? new RegExp(`^${p}\\b`) : new RegExp(`\\b${p}\\b`);
      if (re.test(window)) { tally.set(p, (tally.get(p) || 0) + 1); break; }
    }
  }
  let best = null;
  let bestN = 0;
  for (const [p, n] of tally) if (n > bestN) { best = p; bestN = n; }
  return best;
}

/** Normalize input (string | string[] | {text}[]) to an array of non-empty strings. */
function toTexts(input) {
  if (input == null) return [];
  const arr = Array.isArray(input) ? input : [input];
  const out = [];
  for (const item of arr) {
    let s = null;
    if (typeof item === 'string') s = item;
    else if (item && typeof item === 'object' && typeof item.text === 'string') s = item.text;
    if (s && s.trim()) out.push(s);
  }
  return out;
}

function isContentTerm(term) {
  if (!term || /\d/.test(term)) return false;        // digit-bearing string can never be a term
  if (!/^[a-z][a-z'-]*$/.test(term)) return false;   // pure-alphabetic only (the leak guard)
  if (term.length < 3 || term.length > 30) return false;
  if (STOPWORDS.has(term)) return false;
  return true;
}

/**
 * Extract a deterministic STYLE register from BUYER-side correspondence.
 * @param {string|string[]|{text:string}[]} input buyer text (the caller passes
 *   the buyer side only — gathered via the quarantine/thread path)
 * @param {{maxTerms?:number}} [opts]
 * @returns {{formality, avgSentenceLength, questionRate, greeting, signOff,
 *   lexicon:string[], sampleCount:number, confidence:'high'|'medium'|'low'}}
 */
function extractRegister(input, opts = {}) {
  const texts = toTexts(input);
  const maxTerms = Number.isInteger(opts.maxTerms) && opts.maxTerms > 0 ? opts.maxTerms : 12;

  const formalHits = countMatches(texts, FORMAL_CUES);
  const casualHits = countMatches(texts, CASUAL_CUES);
  let formality = 'neutral';
  if (formalHits > casualHits && formalHits > 0) formality = 'formal';
  else if (casualHits > formalHits && casualHits > 0) formality = 'casual';

  const sents = texts.flatMap(t => sentences(t));
  const totalWords = sents.reduce((sum, s) => sum + words(s).length, 0);
  const avgSentenceLength = sents.length ? Math.round((totalWords / sents.length) * 10) / 10 : 0;
  const questions = sents.filter(s => /\?[)"'\s]*$/.test(s)).length;
  const questionRate = sents.length ? Math.round((questions / sents.length) * 100) / 100 : 0;

  const counts = new Map();
  for (const t of texts) {
    for (const w of words(t)) {
      const term = w.toLowerCase();
      if (isContentTerm(term)) counts.set(term, (counts.get(term) || 0) + 1);
    }
  }
  const lexicon = Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, maxTerms)
    .map(([term]) => term);

  const sampleCount = texts.length;
  const confidence = sampleCount >= 8 ? 'high' : sampleCount >= 3 ? 'medium' : 'low';

  return {
    formality,
    avgSentenceLength,
    questionRate,
    greeting: detectEdge(texts, GREETINGS, 'start') || null,
    signOff: detectEdge(texts, SIGN_OFFS, 'end') || null,
    lexicon,
    sampleCount,
    confidence,
  };
}

module.exports = { extractRegister, sentences, words, isContentTerm, toTexts };
