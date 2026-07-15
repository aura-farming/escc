'use strict';

/*
 * Shared text-safety scanners for the ESCC CI validators.
 *
 * Defines the dangerous-unicode, curly-quote, and personal-path rules ONCE so
 * the dedicated scanners (check-unicode-safety, validate-no-personal-paths) and
 * the per-content validators (skills/agents/commands) all agree. Codepoints are
 * compared numerically — this file contains no raw invisible/emoji characters,
 * so it does not trip its own scan.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * True for invisible / format-control / smuggling codepoints that no legitimate
 * markdown or source should contain. These are the prompt-injection "ASCII
 * smuggling" vectors: invisible to a human reviewer, still consumed by a model.
 * Ported from ECC's check-unicode-safety and extended with U+00A0 NBSP per the
 * ESCC policy (reject zero-width / bidi / NBSP).
 *
 * @param {number} cp codepoint
 * @returns {boolean}
 */
function isDangerousInvisibleCodePoint(cp) {
  return (
    // Raw control characters (C0 except tab/LF/CR, DEL, C1). A single raw NUL
    // hid in scripts/lib/outbound-review.js for weeks: file(1) classified the
    // outbound REVIEW ENGINE as binary, so every plain grep silently skipped
    // it. Control bytes belong in source only as escapes (\u0000), never raw.
    (cp <= 0x08) || cp === 0x0B || cp === 0x0C || (cp >= 0x0E && cp <= 0x1F) ||
    (cp >= 0x7F && cp <= 0x9F) || // DEL + C1 controls
    cp === 0x00A0 || // NBSP
    (cp >= 0x200B && cp <= 0x200D) || // zero-width space / non-joiner / joiner
    cp === 0x2060 || // word joiner
    cp === 0xFEFF || // BOM / zero-width no-break space
    (cp >= 0x202A && cp <= 0x202E) || // bidi embeddings + overrides
    (cp >= 0x2066 && cp <= 0x2069) || // bidi isolates
    (cp >= 0xE0000 && cp <= 0xE007F) || // Unicode Tag block (tag smuggling)
    cp === 0x180E || // Mongolian vowel separator (renders zero-width)
    cp === 0x115F || cp === 0x1160 || // Hangul choseong/jungseong filler
    (cp >= 0x2061 && cp <= 0x2064) || // invisible math operators
    cp === 0x3164 // Hangul filler
  );
}

/**
 * True for emoji variation selectors (VS1-VS16 and the supplement). They are
 * invisible alone but legitimately modify a preceding emoji's presentation, so
 * the unicode scanner treats them as part of the (warned) emoji tier rather
 * than as a hard smuggling error — unlike the truly invisible vectors above.
 * @param {number} cp codepoint
 * @returns {boolean}
 */
function isVariationSelector(cp) {
  return (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF);
}

// Curly quotes are warned-on (not rejected): they are safe but discouraged in
// authored content. ESCC policy: warn on curly quotes.
const CURLY_QUOTE_RE = /[\u2018\u2019\u201C\u201D]/;

// `~/...` paths are warned-on (acceptable in install-path documentation).
const TILDE_PATH_RE = /~\//;

// Personal absolute paths are rejected. Obvious placeholder usernames used in
// templates/examples are allowed.
const POSIX_USER_RE = /\/Users\/([A-Za-z][A-Za-z0-9._-]*)/g;
const HOME_USER_RE = /\/home\/([A-Za-z][A-Za-z0-9._-]*)/g;
const WIN_USER_RE = /C:\\Users\\([A-Za-z][A-Za-z0-9._-]*)/gi;
const PLACEHOLDER_USERNAMES = new Set([
  'example', 'me', 'user', 'username', 'you', 'yourname', 'yourusername', 'your-username',
]);

/**
 * Find user-specific absolute paths leaked into content.
 * @param {string} content
 * @returns {string[]} the offending path substrings (placeholders excluded)
 */
function findPersonalPaths(content) {
  const leaks = [];
  for (const pattern of [POSIX_USER_RE, HOME_USER_RE, WIN_USER_RE]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (!PLACEHOLDER_USERNAMES.has(match[1].toLowerCase())) leaks.push(match[0]);
    }
  }
  return leaks;
}

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find banned company tokens in content (the de-companyfication guard, CLAUDE.md
 * §4/§5 + ADR open-source-readiness). A plain word token is matched
 * case-insensitively with NON-word boundaries on both sides, so a short brand
 * name can never trip on a larger word that merely contains it as a substring. A
 * domain- or email-host-shaped token (one containing a dot) is matched literally
 * anywhere, so it also covers addresses like name@that-host.
 * @param {string} content
 * @param {string[]} tokens
 * @returns {string[]} the offending matched substrings (verbatim)
 */
function findBannedTokens(content, tokens) {
  const hits = [];
  for (const token of tokens || []) {
    if (!token || typeof token !== 'string') continue;
    const esc = escapeRegExp(token);
    const re = token.includes('.')
      ? new RegExp(esc, 'gi')
      : new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'gi');
    let m;
    while ((m = re.exec(content)) !== null) {
      hits.push(m[0]);
      if (m.index === re.lastIndex) re.lastIndex += 1; // zero-width guard
    }
  }
  return hits;
}

// Hashed banned tokens: the public config stores sha256(lowercase(token)) so the
// repo never discloses the name it bans. Candidates are every word-shaped run
// ([a-z0-9]+, preserving the old word-boundary semantics — a word token still
// matches inside an email or domain because labels split on '.') and every
// label-aligned dotted-host substring (covering banned domains/email hosts).
const WORD_RUN_RE = /[a-z0-9]+/g;
const HOST_RUN_RE = /[a-z0-9-]+(?:\.[a-z0-9-]+)+/g;

/**
 * Find banned tokens by hash. Returns the offending candidate substrings.
 * @param {string} content
 * @param {Iterable<string>} hashes lowercase sha256 hex digests
 * @returns {string[]}
 */
function findBannedTokenHashes(content, hashes) {
  const banned = new Set([...(hashes || [])].map(h => String(h).toLowerCase()));
  if (!banned.size) return [];
  const crypto = require('crypto');
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const text = content.toLowerCase();
  const candidates = new Set(text.match(WORD_RUN_RE) || []);
  for (const host of text.match(HOST_RUN_RE) || []) {
    const labels = host.split('.');
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j <= labels.length; j += 1) {
        candidates.add(labels.slice(i, j).join('.'));
      }
    }
  }
  const hits = [];
  for (const candidate of candidates) {
    if (banned.has(sha(candidate))) hits.push(candidate);
  }
  return hits;
}

// Email addresses in committed files must belong to fixture/placeholder domains
// (config/committed-email-domains.json) or an RFC 2606 reserved TLD. A real
// prospect/customer/colleague address can never ship in the public source.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,})\b/g;
const RESERVED_TLD_RE = /\.(?:example|test|invalid|localhost)$/i;

/**
 * Find email addresses whose domain is neither an allowed fixture domain (or a
 * subdomain of one) nor an RFC 2606 reserved TLD (.example/.test/.invalid/
 * .localhost). Returns the offending full addresses, verbatim.
 * @param {string} content
 * @param {Iterable<string>} allowedDomains lowercase fixture domains
 * @returns {string[]}
 */
function findForeignEmails(content, allowedDomains) {
  const allowed = new Set([...(allowedDomains || [])].map(d => String(d).toLowerCase()));
  const leaks = [];
  EMAIL_RE.lastIndex = 0;
  let m;
  while ((m = EMAIL_RE.exec(content)) !== null) {
    const domain = m[1].toLowerCase();
    const ok =
      RESERVED_TLD_RE.test(domain) ||
      allowed.has(domain) ||
      [...allowed].some(d => domain.endsWith(`.${d}`));
    if (!ok) leaks.push(m[0]);
  }
  return leaks;
}

/**
 * List git-TRACKED repo-relative file paths — the canonical scan scope for the
 * public-source guards. Gitignored runtime data (a private workspace's real
 * org/customer data) is legitimately absent. Throws when git is unavailable;
 * callers decide whether to skip or fall back to a filesystem walk.
 * @param {string} root repo root
 * @returns {string[]}
 */
function listTrackedFiles(root) {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

// High-confidence committed-secret signatures (near-zero false positives). The
// generic key=value rule (last) is the only one that captures a value group, so
// it alone is filtered against obvious placeholders.
const SECRET_PATTERNS = [
  { type: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { type: 'GitHub token', re: /\bgh[posru]_[A-Za-z0-9]{36,}\b/g },
  { type: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { type: 'Slack webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
  { type: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'Stripe live key', re: /\b[sprk]k_live_[0-9A-Za-z]{20,}\b/g },
  { type: 'Twilio account SID', re: /\bAC[0-9a-f]{32}\b/g },
  { type: 'secret assignment', re: /\b(?:api[_-]?key|secret|access[_-]?token|client[_-]?secret|auth[_-]?token|private[_-]?key)\b["'\s]*[:=]["'\s]*([A-Za-z0-9/+_-]{24,})/gi },
];

// Substrings that mark a captured value as a placeholder, not a real secret.
const SECRET_PLACEHOLDER_RE = /(?:example|placeholder|your[_-]?|change[_-]?me|redacted|dummy|sample|fake|test|xxxx|\.\.\.)/i;

/**
 * Find committed-secret signatures in content. Returns the secret TYPE plus a
 * truncated match (never the full secret) so CI output cannot itself leak one.
 * @param {string} content
 * @returns {{type: string, match: string}[]}
 */
function findSecrets(content) {
  const hits = [];
  for (const { type, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const captured = m[1];
      if (captured !== undefined && SECRET_PLACEHOLDER_RE.test(captured)) {
        if (m.index === re.lastIndex) re.lastIndex += 1;
        continue;
      }
      hits.push({ type, match: `${m[0].slice(0, 24)}…` });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return hits;
}

/**
 * 1-based line and column for a character index into `text`.
 * @param {string} text
 * @param {number} index
 * @returns {{line: number, column: number}}
 */
function lineAndColumn(text, index) {
  const line = text.slice(0, index).split('\n').length;
  const lastNewline = text.lastIndexOf('\n', index - 1);
  return { line, column: index - lastNewline };
}

const DEFAULT_IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.next', '.venv', 'venv', 'coverage', '.dmux',
]);

/**
 * Recursively list files under `root`, skipping ignored directories.
 * @param {string} root
 * @param {{ignoreDirs?: Set<string>, exts?: Set<string>}} [options]
 *   `exts` (lowercase, dot-prefixed) restricts to those extensions when given.
 * @returns {string[]} absolute file paths
 */
function walkFiles(root, options = {}) {
  const ignoreDirs = options.ignoreDirs || DEFAULT_IGNORE_DIRS;
  const exts = options.exts || null;
  const out = [];

  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (!exts || exts.has(path.extname(entry.name).toLowerCase())) {
          out.push(path.join(dir, entry.name));
        }
      }
    }
  })(root);

  return out;
}

module.exports = {
  isDangerousInvisibleCodePoint,
  isVariationSelector,
  CURLY_QUOTE_RE,
  TILDE_PATH_RE,
  findPersonalPaths,
  escapeRegExp,
  findBannedTokens,
  findBannedTokenHashes,
  findForeignEmails,
  findSecrets,
  listTrackedFiles,
  lineAndColumn,
  walkFiles,
  DEFAULT_IGNORE_DIRS,
};
