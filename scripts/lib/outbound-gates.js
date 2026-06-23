/*
 * ESCC outbound gates — the deterministic, no-network checks behind the
 * outbound enforcement protocol (NEW for ESCC, v1.1.0).
 *
 * Two surfaces:
 *
 *   evaluateGates({ draft, records, now })  — the FULL four-gate evaluation the
 *     blessed path runs once it has gathered the contact's CRM history. Each
 *     gate returns pass | block | warn with a reason; blocks can carry a
 *     blocklist write (do-not-contact). This is where all history-based
 *     judgement happens, so the PreToolUse hook never needs CRM data.
 *
 *   inspectPayload({ recipient, subject, body }) — the CHEAP subset the hook
 *     runs on the raw tool payload with NO records: an overclaim-phrase scan and
 *     a WIIFM-opener heuristic. It warns by default and hard-fails only the
 *     egregious cases, so it never over-blocks a legitimate, approved send.
 *
 * The four gates (each composable, each emits pass/block + reason):
 *   1. timing / do-not-contact-until — honor "call back in six weeks" etc.
 *   2. claim-vs-record (fabrication firewall) — every "you asked / as discussed"
 *      claim must trace to a note; unsupported or conflicting → block.
 *   3. WIIFM — the opener must lead with the recipient's payoff, not product.
 *   4. contactability — no outbound to open-deal / demo-booked / handed-to-AE /
 *      customer / previously-declined accounts.
 *
 * Pure module: no filesystem, no MCP, no escc deps. Heuristic by design — the
 * outbound-reviewer agent supplies the semantic >80%-confidence layer on top.
 */

'use strict';

// --- shared text helpers -----------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for',
  'with', 'as', 'by', 'is', 'it', 'this', 'that', 'these', 'those', 'be', 'are',
  'was', 'were', 'will', 'would', 'can', 'could', 'should', 'have', 'has', 'had',
  'i', 'you', 'your', 'yours', 'we', 'our', 'us', 'me', 'my', 'he', 'she', 'they',
  'them', 'their', 'please', 'thanks', 'thank', 'hi', 'hey', 'hello', 're', 'fwd',
  // generic verbs that should not by themselves "support" a claim
  'send', 'sent', 'sending', 'look', 'looking', 'looked', 'get', 'got', 'see',
  'go', 'going', 'want', 'wanted', 'need', 'needed', 'take', 'make', 'give',
  'let', 'know', 'just', 'quick', 'over', 'through', 'about', 'into', 'from',
]);

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function lc(value) {
  return normalizeText(value).toLowerCase();
}

/** Distinctive content tokens (drops stopwords + generic verbs + short tokens). */
function salientTokens(text) {
  const tokens = lc(text).split(/[^a-z0-9]+/).filter(Boolean);
  return new Set(tokens.filter(t => t.length >= 3 && !STOPWORDS.has(t)));
}

/** Split into rough sentences for opener / claim-context extraction. */
function sentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function firstSentence(text) {
  const s = sentences(text);
  return s.length ? s[0] : '';
}

// --- date / duration parsing -------------------------------------------------

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3,
};

const UNIT_DAYS = { day: 1, week: 7, fortnight: 14, month: 30, quarter: 90, year: 365 };

function toDate(value) {
  if (value instanceof Date) return value;
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Parse a relative window like "six weeks", "a month", "next quarter", "2 days"
 * into a day count. Returns 0 when nothing parseable is present.
 */
function parseWindowDays(phrase) {
  const text = lc(phrase);
  const m = text.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|next)\s+(?:of\s+)?(day|week|fortnight|month|quarter|year)s?\b/);
  if (!m) {
    // "next week/month/quarter" without a number, or a bare unit
    const bare = text.match(/\b(?:next\s+)?(day|week|fortnight|month|quarter|year)\b/);
    if (bare) return UNIT_DAYS[bare[1]] || 0;
    return 0;
  }
  const qtyToken = m[1];
  const qty = qtyToken === 'next' ? 1 : (/^\d+$/.test(qtyToken) ? parseInt(qtyToken, 10) : (NUMBER_WORDS[qtyToken] || 0));
  const unit = UNIT_DAYS[m[2]] || 0;
  return qty * unit;
}

// --- phrase libraries --------------------------------------------------------

// Hard do-not-contact (indefinite) signals.
const DNC_INSTANT = [
  'do not contact', "don't contact", 'do not call', "don't call",
  'do not email', "don't email", 'unsubscribe', 'remove me', 'opt out',
  'opt-out', 'not interested', 'no interest', 'stop contacting', 'stop emailing',
  'lose my number', 'take me off',
];

// "wait a while" signals — pair with a parsed window for a not-before date.
const DNC_WINDOW_LEADS = [
  'call back in', 'call me back in', 'contact me in', 'reach out in',
  'reach back out in', 'touch base in', 'circle back in', 'check back in',
  'follow up in', 'follow-up in', 'get back to me in', 'come back to me in',
  'try me again in', 'ping me in', 'revisit in', 'check in in', 'check in with me in',
];

// Soft "not now" signals — block conservatively for a default cooldown.
const DNC_SOFT = [
  'not now', 'not right now', 'no interest at the moment', 'not at the moment',
  'bad time', 'busy right now', 'maybe later', 'not a priority right now',
];

// Claims that assert a prior interaction and therefore must trace to a record.
const CLAIM_PHRASES = [
  'you asked', 'you requested', 'as you requested', 'as requested',
  'you agreed', 'as we agreed', 'as agreed', 'as discussed', 'as we discussed',
  'you mentioned', 'you said', 'you told me', 'you wanted', 'you asked me to',
  'per your request', 'per our conversation', 'following our conversation',
  'when we spoke', 'on our call', 'as promised', 'like you said',
];

// Opener phrases that lead with product/process/logistics rather than payoff.
const WIIFM_BAD_OPENERS = [
  'comparison', ' vs ', 'versus', 'let me show', 'i wanted to show',
  "i'd love to show", 'i would love to show', 'wanted to show you',
  'we offer', 'we provide', 'we sell', 'we built', 'we have a', 'our product',
  'our platform', 'our solution', 'our software', 'our tool', 'a demo', 'demo of',
  'walk you through', 'give you a tour', 'show you how', 'book a', 'schedule a',
  'set up a call', 'hop on a call', 'jump on a call', 'touch base', 'circle back',
  'just following up', 'just checking in', 'checking in', 'reaching out to',
  'my name is', "i'm a", 'i am a', 'i work at', 'i work for',
];

// Strong recipient-benefit signals that make an opener acceptable. NOTE: bare
// pronouns ("you"/"your") are deliberately NOT here — "...comparison for you" at
// the tail of a product-first opener is not WIIFM. A leading you/your is handled
// separately (an opener that STARTS on the recipient).
const WIIFM_BENEFIT_SIGNALS = [
  'save', 'saving', 'cut', 'reduce', 'reducing', 'increase', 'grow', 'avoid',
  'stop losing', 'win back', 'fewer', 'faster', 'less time', 'overtime',
  'compliance', 'roster', 'payroll', 'staff cost', 'cost', 'risk', 'fine',
  'penalt', 'hours back', 'save you', 'help you',
];

/** Does the opener LEAD on the recipient (starts with you/your)? */
function leadsWithRecipient(openerLc) {
  return /^\W*(you|your)\b/.test(openerLc);
}

// Egregious payload-only overclaims the cheap hook check may hard-fail.
const EGREGIOUS_OVERCLAIM = [
  /\bguaranteed?\b[^.!?\n]{0,40}\b(roi|results?|savings?|outcome)\b/i,
  /\b100%\s+guarantee/i,
  /\bno[- ]risk\b[^.!?\n]{0,30}\bguarantee/i,
];

function containsAny(haystack, needles) {
  const text = lc(haystack);
  return needles.find(n => text.includes(lc(n))) || null;
}

// --- records normalization ---------------------------------------------------

/** Accept either records.notes or records.history; normalize to [{date,text}]. */
function notesOf(records) {
  const raw = (records && (records.notes || records.history)) || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(n => (typeof n === 'string' ? { date: null, text: n } : { date: n.date || n.ts || null, text: n.text || n.body || '' }))
    .filter(n => n.text);
}

// --- the four gates ----------------------------------------------------------

/**
 * Gate 1 — timing / do-not-contact-until.
 * Scans contact+company history for explicit wait/stop signals and blocks an
 * outbound that would land before the requested window has elapsed.
 */
function gateTiming({ records, now }) {
  const when = toDate(now) || new Date();
  const notes = notesOf(records);
  let latestNotBefore = null;
  let windowReason = null;

  for (const note of notes) {
    const text = lc(note.text);
    const hardHit = containsAny(text, DNC_INSTANT);
    if (hardHit) {
      return { status: 'block', reason: `contact signalled do-not-contact ("${hardHit}") in a note; this is an indefinite suppression`, not_before: null, blocklist: { scope: 'contact', reason: `do-not-contact: "${hardHit}"`, not_before: null } };
    }

    const lead = DNC_WINDOW_LEADS.find(l => text.includes(l));
    if (lead) {
      const after = text.slice(text.indexOf(lead) + lead.length);
      const days = parseWindowDays(after);
      if (days > 0) {
        const anchor = toDate(note.date) || when;
        const notBefore = addDays(anchor, days);
        if (notBefore > (latestNotBefore || 0)) {
          latestNotBefore = notBefore;
          windowReason = `contact asked to be re-contacted later ("${lead}${after.slice(0, 24)}"); not before ${notBefore.toISOString().slice(0, 10)}`;
        }
      }
    }

    const soft = containsAny(text, DNC_SOFT);
    if (soft && !latestNotBefore) {
      const anchor = toDate(note.date) || when;
      const notBefore = addDays(anchor, 14); // conservative default cooldown
      if (notBefore > when) {
        latestNotBefore = notBefore;
        windowReason = `contact signalled "${soft}"; default cooldown until ${notBefore.toISOString().slice(0, 10)}`;
      }
    }
  }

  if (latestNotBefore && latestNotBefore > when) {
    return { status: 'block', reason: windowReason, not_before: latestNotBefore.toISOString(), blocklist: { scope: 'contact', reason: windowReason, not_before: latestNotBefore.toISOString() } };
  }
  return { status: 'pass' };
}

/**
 * Gate 2 — claim-vs-record (the fabrication firewall).
 * Every claim of a prior interaction in the draft must trace to a note. A claim
 * that no note supports is blocked, quoting the most recent note as evidence the
 * record does not back it. `records.verifiedClaims` lets the blessed path attest
 * a specific claim explicitly.
 */
function gateClaims({ draft, records }) {
  const body = (draft && (draft.body || draft.text)) || '';
  const notes = notesOf(records);
  const verified = new Set(((records && records.verifiedClaims) || []).map(lc));
  const noteTokenSets = notes.map(n => salientTokens(n.text));

  for (const sentence of sentences(body)) {
    const sLc = lc(sentence);
    const phrase = CLAIM_PHRASES.find(p => sLc.includes(p));
    if (!phrase) continue;
    if (verified.has(sLc)) continue;

    // Object of the claim = the salient tokens of the sentence (minus the phrase).
    const objectTokens = salientTokens(sentence.replace(new RegExp(phrase, 'i'), ' '));
    if (objectTokens.size === 0) continue; // nothing concrete claimed

    const supported = noteTokenSets.some(noteTokens => {
      for (const t of objectTokens) if (noteTokens.has(t)) return true;
      return false;
    });

    if (!supported) {
      const latest = notes.length ? notes[notes.length - 1].text : null;
      const evidence = latest ? ` records say: "${normalizeText(latest).slice(0, 120)}"` : ' no supporting note exists';
      return { status: 'block', reason: `claim "${normalizeText(sentence).slice(0, 80)}" is not supported by any call/note;${evidence}` };
    }
  }
  return { status: 'pass' };
}

/**
 * Gate 3 — WIIFM. The opener must lead with the recipient's benefit, not
 * product/process/logistics. Hardest (block) for prospects with no prior
 * engagement; otherwise a warning to rewrite.
 */
function gateWiifm({ draft, records }) {
  const body = (draft && (draft.body || draft.text)) || '';
  const opener = normalizeText((draft && draft.openingLine) || firstSentence(body));
  if (!opener) return { status: 'pass' };

  const bad = containsAny(opener, WIIFM_BAD_OPENERS);
  if (!bad) return { status: 'pass' };

  const openerLc = lc(opener);
  const hasBenefit = leadsWithRecipient(openerLc) || WIIFM_BENEFIT_SIGNALS.some(sig => openerLc.includes(sig));
  if (hasBenefit) return { status: 'pass' };

  const priorEngagement = !!(records && records.priorEngagement);
  const reason = `opener leads with product/process ("${bad.trim()}"), not the recipient's payoff — rewrite to lead with what's in it for them`;
  return priorEngagement ? { status: 'warn', reason } : { status: 'block', reason };
}

/**
 * Gate 4 — contactability. No prospecting outbound to accounts that are
 * open-deal / demo-booked / handed-to-AE / existing-customer / previously
 * declined. Derived from HubSpot lead_status, open deals, lifecycle, history.
 */
function gateContactability({ records }) {
  const r = records || {};
  const openDeals = Array.isArray(r.open_deals) ? r.open_deals.length : Number(r.open_deals || 0);
  const lifecycle = lc(r.lifecycle || r.lifecyclestage);
  const leadStatus = lc(r.lead_status || r.lead_status_label);

  const reasons = [];
  if (openDeals > 0) reasons.push('the account has an open deal');
  if (r.demo_booked || /demo|meeting.?booked|scheduled/.test(leadStatus)) reasons.push('a demo/meeting is already booked');
  if (r.handed_to_ae || /handed|ae[- ]?owned|sql/.test(leadStatus)) reasons.push('the account has been handed to an AE');
  if (/customer|existing|won/.test(lifecycle)) reasons.push('the account is an existing customer');
  if (r.declined || /declined|disqualif|closed[- ]?lost|not a fit/.test(leadStatus)) reasons.push('the account previously declined');

  if (reasons.length) {
    const reason = `do not prospect: ${reasons.join('; ')}`;
    return { status: 'block', reason, blocklist: { scope: 'account', reason, not_before: null } };
  }
  return { status: 'pass' };
}

/**
 * Run all four gates. Overall pass requires no gate to block (warnings are
 * allowed and surfaced). Returns the per-gate verdicts, the aggregated blocks
 * and warnings, and any blocklist writes the caller should persist.
 *
 * @param {{draft:{subject?:string,body?:string,openingLine?:string}, records?:object, now?:string|Date}} args
 */
function evaluateGates(args = {}) {
  const { draft = {}, records = {}, now } = args;
  const gates = {
    timing: gateTiming({ records, now }),
    claim: gateClaims({ draft, records }),
    wiifm: gateWiifm({ draft, records }),
    contactability: gateContactability({ records }),
  };

  const blocks = [];
  const warnings = [];
  const blocklistWrites = [];
  for (const [name, verdict] of Object.entries(gates)) {
    if (verdict.status === 'block') {
      blocks.push({ gate: name, reason: verdict.reason, not_before: verdict.not_before ?? null });
      if (verdict.blocklist) blocklistWrites.push(verdict.blocklist);
    } else if (verdict.status === 'warn') {
      warnings.push({ gate: name, reason: verdict.reason });
    }
  }

  return { pass: blocks.length === 0, gates, blocks, warnings, blocklistWrites };
}

/**
 * Cheap, no-records payload inspection for the PreToolUse hook. Warns on
 * prior-agreement claims (which it cannot verify without records) and on a
 * product-first opener; hard-fails only egregious overclaims. Never depends on
 * CRM data — the heavy judgement already ran in the blessed path.
 *
 * @param {{recipient?:string, subject?:string, body?:string}} payload
 * @returns {{warnings:string[], block:(string|null)}}
 */
function inspectPayload(payload = {}) {
  const body = String(payload.body || '');
  const warnings = [];

  for (const re of EGREGIOUS_OVERCLAIM) {
    if (re.test(body)) {
      return { warnings, block: 'egregious overclaim in the body (e.g. "guaranteed ROI"); this cannot ship — remove the unsubstantiated guarantee' };
    }
  }

  const claim = containsAny(body, CLAIM_PHRASES);
  if (claim) {
    warnings.push(`body asserts a prior interaction ("${claim}") — confirm it traces to a note before this goes out`);
  }

  const opener = firstSentence(body);
  const openerLc = lc(opener);
  const badOpener = containsAny(opener, WIIFM_BAD_OPENERS);
  if (badOpener && !leadsWithRecipient(openerLc) && !WIIFM_BENEFIT_SIGNALS.some(sig => openerLc.includes(sig))) {
    warnings.push(`opener may lead with product/process ("${badOpener.trim()}") rather than the recipient's payoff`);
  }

  return { warnings, block: null };
}

module.exports = {
  evaluateGates,
  inspectPayload,
  // individual gates (unit-tested directly)
  gateTiming,
  gateClaims,
  gateWiifm,
  gateContactability,
  // helpers (unit-tested + reused)
  parseWindowDays,
  salientTokens,
  firstSentence,
  sentences,
  normalizeText,
  // phrase libraries (exported so tests + config can reference them)
  CLAIM_PHRASES,
  WIIFM_BAD_OPENERS,
  DNC_INSTANT,
  DNC_WINDOW_LEADS,
};
