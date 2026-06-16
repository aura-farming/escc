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
  lineAndColumn,
  walkFiles,
  DEFAULT_IGNORE_DIRS,
};
