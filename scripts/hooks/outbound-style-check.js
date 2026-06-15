#!/usr/bin/env node
/* ESCC outbound-style-check — WARN-ONLY heuristics on outbound copy (NEW for ESCC). */

/*
 * PostToolUse hook (matcher Edit|Write; profiles standard,strict).
 *
 * When an Edit/Write targets outbound content (a path under /outbound/,
 * /sequences/, /emails/, /templates/, or a deliverables/ outbound area), this
 * hook inspects the written copy and surfaces deliverability/quality risks as a
 * single non-blocking {additionalContext} message:
 *
 *   - subject line longer than MAX_SUBJECT_LEN chars (Subject: line or a
 *     subject: frontmatter/JSON field)
 *   - spam-trigger words (curated SPAM_WORDS list)
 *   - a sequence file with no unsubscribe/opt-out block (same token idea as
 *     compliance-protection.js)
 *   - broken/empty merge fields ({{ }}, {{}}, {{undefined}}, unbalanced braces)
 *
 * It NEVER blocks. ESCC_QUALITY_GATE_STRICT (default false) only firms the
 * wording; the result is still warn-only. Synchronous, fails open on any error.
 */

'use strict';

const path = require('path');
const { parseHookInput, getToolInput, getFilePath } = require('../lib/hook-input');

const MAX_SUBJECT_LEN = 60;

// Outbound-content path signals. Edits outside these are ignored.
const OUTBOUND_PATH = /(^|\/)(outbound|sequences|emails|templates)\//i;
const DELIVERABLES_OUTBOUND = /(^|\/)deliverables\/[^/]*(outbound|sequence|email|template)/i;

// Sequence files specifically (where a missing unsubscribe footer matters most).
const SEQUENCE_PATH = /(^|\/)(sequences|outbound)\//i;
const UNSUBSCRIBE_TOKENS = /(unsubscribe|opt[\s-]?out|\{\{\s*unsubscribe)/i;

// Curated spam-trigger word/phrase list. Matched case-insensitively as whole
// words/phrases. Kept small and high-signal on purpose (warn-only).
const SPAM_WORDS = [
  'free',
  'guarantee',
  'guaranteed',
  'act now',
  'limited time',
  'risk-free',
  'risk free',
  'click here',
  'buy now',
  'order now',
  'no obligation',
  'cash bonus',
  'this is not spam',
  'winner',
  'congratulations',
  '100% free',
  '$$$',
];

function normalize(p) {
  return String(p || '').replace(/\\/g, '/');
}

function isStrict() {
  return /^(1|true|yes|on)$/i.test(String(process.env.ESCC_QUALITY_GATE_STRICT || '').trim());
}

/** Does this path look like outbound content we should inspect? */
function isOutboundContent(filePath) {
  const norm = normalize(filePath);
  if (!norm) return false;
  if (!/\.(md|txt|json|ya?ml|html?)$/i.test(norm)) return false;
  return OUTBOUND_PATH.test(norm) || DELIVERABLES_OUTBOUND.test(norm);
}

/** Is this an outreach sequence file (unsubscribe footer required)? */
function isSequenceFile(filePath) {
  return SEQUENCE_PATH.test(normalize(filePath));
}

/**
 * Pull the subject line value, from a `Subject:` line or a `subject:`
 * frontmatter/JSON field. Returns '' when none is present.
 */
function extractSubject(content) {
  const text = String(content || '');
  // Subject: ... (email header style)
  const header = text.match(/^[ \t]*subject[ \t]*:[ \t]*(.+)$/im);
  if (header) {
    return stripQuotes(header[1].trim());
  }
  // "subject": "..." (JSON field)
  const json = text.match(/["']subject["']\s*:\s*["']([^"']*)["']/i);
  if (json) {
    return json[1].trim();
  }
  return '';
}

function stripQuotes(value) {
  const v = String(value || '').trim();
  if (v.length >= 2 && /^["'].*["']$/.test(v)) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/** Spam-trigger words present in the copy (deduped, in list order). */
function findSpamWords(content) {
  const text = String(content || '');
  const found = [];
  for (const word of SPAM_WORDS) {
    // Escape regex metachars; use whole-token boundaries where the word is
    // alphabetic, otherwise a plain (escaped) substring match.
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundary = /^[a-z0-9]/i.test(word) && /[a-z0-9]$/i.test(word)
      ? new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i')
      : new RegExp(escaped, 'i');
    if (boundary.test(text)) found.push(word);
  }
  return found;
}

/**
 * Detect broken/empty merge fields. Catches:
 *   - empty: {{}} or {{   }}
 *   - literal undefined/null token: {{undefined}}, {{ null }}
 *   - unbalanced braces: {{ firstName }  or  { firstName }}
 */
function findBrokenMergeFields(content) {
  const text = String(content || '');
  const issues = [];

  if (/\{\{\s*\}\}/.test(text)) issues.push('empty merge field ({{}})');
  if (/\{\{\s*(undefined|null)\s*\}\}/i.test(text)) {
    issues.push('placeholder merge field ({{undefined}} / {{null}})');
  }

  // Unbalanced: a {{ not closed by }} before the next {{ or end, or a }}
  // with no opening {{. Count opens vs closes as a cheap balance check.
  const opens = (text.match(/\{\{/g) || []).length;
  const closes = (text.match(/\}\}/g) || []).length;
  if (opens !== closes) {
    issues.push(`unbalanced merge-field braces (${opens} "{{" vs ${closes} "}}")`);
  }

  return issues;
}

/**
 * @param {string|object} raw
 * @param {object} [ctx]
 * @returns {{additionalContext:string}|undefined}
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const toolInput = getToolInput(input);
    const filePath = getFilePath(toolInput);
    if (!filePath || !isOutboundContent(filePath)) return undefined;

    const content = toolInput.content || toolInput.new_string || '';
    if (!content) return undefined;
    const text = String(content);

    const findings = [];

    const subject = extractSubject(text);
    if (subject && subject.length > MAX_SUBJECT_LEN) {
      findings.push(
        `subject line is ${subject.length} chars (>${MAX_SUBJECT_LEN}); long subjects truncate in inboxes and depress open rates`
      );
    }

    const spam = findSpamWords(text);
    if (spam.length) {
      findings.push(`spam-trigger words present: ${spam.join(', ')} — these hurt deliverability`);
    }

    if (isSequenceFile(filePath) && !UNSUBSCRIBE_TOKENS.test(text)) {
      findings.push(
        'no unsubscribe/opt-out block in this sequence file — bulk/commercial email must carry one (AU Spam Act 2003 / CAN-SPAM / PECR)'
      );
    }

    const merge = findBrokenMergeFields(text);
    if (merge.length) {
      findings.push(`broken merge field(s): ${merge.join('; ')}`);
    }

    if (!findings.length) return undefined;

    const base = path.posix.basename(normalize(filePath));
    const lead = isStrict()
      ? `⚠️ outbound-style-check (STRICT): fix before this outbound copy in ${base} is used —`
      : `⚠️ outbound-style-check: review this outbound copy in ${base} —`;
    const body = findings.map((f) => `  - ${f}`).join('\n');

    return { additionalContext: `${lead}\n${body}` };
  } catch (_err) {
    return { exitCode: 0 }; // fail open on internal error
  }
}

module.exports = {
  run,
  isOutboundContent,
  isSequenceFile,
  extractSubject,
  findSpamWords,
  findBrokenMergeFields,
  SPAM_WORDS,
  MAX_SUBJECT_LEN,
};

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  let result;
  try { result = run(raw, {}); } catch (_err) { result = { exitCode: 0 }; }
  if (result && typeof result.additionalContext === 'string') {
    process.stdout.write(`${result.additionalContext}\n`);
  } else {
    process.stdout.write(raw);
  }
  process.exit(0); // warn-only: always pass through
}
