#!/usr/bin/env node
'use strict';

/*
 * Repo-wide unicode safety scan.
 *
 * - Dangerous invisible / bidi / smuggling codepoints (incl. NBSP) are ALWAYS
 *   an error and fail the run. These are the "ASCII smuggling" prompt-injection
 *   vectors — invisible to a human reviewer, still consumed by a model — and the
 *   reason the trust boundary treats prospect/document content as untrusted.
 * - Emoji / pictographic symbols (excluding (C) (R) TM) are a soft finding:
 *   they warn by default and fail only under strict mode (CI_STRICT=1 / --strict).
 *
 * Scope: every text file in the repo, minus ignored dirs. Override the root with
 * ESCC_UNICODE_SCAN_ROOT (mirrors ECC_UNICODE_SCAN_ROOT).
 */

const fs = require('fs');
const path = require('path');
const { isDangerousInvisibleCodePoint, isVariationSelector, lineAndColumn, walkFiles } = require('./lib/text-scan');
const { STRICT } = require('./lib/report');

const ROOT = process.env.ESCC_UNICODE_SCAN_ROOT
  ? path.resolve(process.env.ESCC_UNICODE_SCAN_ROOT)
  : path.resolve(__dirname, '..', '..');

const TEXT_EXTS = new Set([
  '.md', '.mdx', '.txt', '.js', '.cjs', '.mjs', '.json', '.yml', '.yaml', '.sh', '.toml',
]);

const EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/gu;
const ALLOWED_SYMBOL_CODEPOINTS = new Set([0x00A9, 0x00AE, 0x2122]); // (C) (R) TM

// Drift ratchet (v1.10.0): today's emoji findings are all deliberate
// (hook-output glyphs, fixtures that TEST emoji handling in prospect content),
// so they warn rather than fail — but CI runs the default (non-strict) mode,
// so without a ceiling the count could only grow unnoticed. Adding emoji must
// be a conscious decision: bump this pin in the same change, or the default
// run fails in main() below.
const EMOJI_BASELINE = 34;

function isAllowedSymbol(char) {
  return ALLOWED_SYMBOL_CODEPOINTS.has(char.codePointAt(0));
}

function describeChar(char) {
  return [...char].map(c => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(' ');
}

function scanFile(absPath) {
  const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    return { dangerous: [], emoji: [] };
  }

  const dangerous = [];
  const emoji = [];
  let index = 0;
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (isDangerousInvisibleCodePoint(cp)) {
      const { line, column } = lineAndColumn(text, index);
      dangerous.push(`${rel}:${line}:${column} U+${cp.toString(16).toUpperCase()}`);
    } else if (isVariationSelector(cp)) {
      const { line, column } = lineAndColumn(text, index);
      emoji.push(`${rel}:${line}:${column} U+${cp.toString(16).toUpperCase()} (variation selector)`);
    }
    index += char.length;
  }

  for (const match of text.matchAll(EMOJI_RE)) {
    if (isAllowedSymbol(match[0])) continue;
    const { line, column } = lineAndColumn(text, match.index ?? 0);
    emoji.push(`${rel}:${line}:${column} ${describeChar(match[0])}`);
  }

  return { dangerous, emoji };
}

function main() {
  const files = walkFiles(ROOT, { exts: TEXT_EXTS });
  const dangerous = [];
  const emoji = [];

  for (const file of files) {
    const result = scanFile(file);
    dangerous.push(...result.dangerous);
    emoji.push(...result.emoji);
  }

  for (const hit of emoji) {
    if (STRICT) console.error(`ERROR: emoji/pictographic ${hit}`);
    else console.warn(`WARN: emoji/pictographic ${hit}`);
  }
  for (const hit of dangerous) {
    console.error(`ERROR: dangerous unicode ${hit}`);
  }

  const failed = dangerous.length + (STRICT ? emoji.length : 0);
  if (failed > 0) {
    console.error(`check-unicode-safety: FAIL (${dangerous.length} dangerous${STRICT ? `, ${emoji.length} emoji` : ''})`);
    process.exit(1);
  }
  if (emoji.length > EMOJI_BASELINE) {
    console.error(
      `check-unicode-safety: FAIL — ${emoji.length} emoji findings exceed the pinned baseline (${EMOJI_BASELINE}). ` +
      'New emoji must be deliberate: remove them, or bump EMOJI_BASELINE in the same change.'
    );
    process.exit(1);
  }

  const emojiNote = emoji.length ? `, ${emoji.length} emoji warning${emoji.length === 1 ? '' : 's'}` : '';
  console.log(`Unicode safety check passed (${files.length} files scanned${emojiNote})`);
  process.exit(0);
}

main();
