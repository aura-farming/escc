#!/usr/bin/env node
'use strict';

/*
 * Anti-recurrence guard: no banned company token in COMMITTED data (CLAUDE.md
 * §4/§5; open-source-readiness ADR). After the de-companyfication sweep, this
 * keeps the public source company-neutral — a brand name can never leak back
 * into committed example/seed/demo/test data again.
 *
 * Scans only git-TRACKED files (via `git ls-files`), so it never false-fails on
 * gitignored runtime data (~/.claude/escc/...), which legitimately holds a real
 * org's tokens in a private workspace. The banned list is config/banned-company-
 * tokens.json — shipped as sha256 HASHES (`token_hashes`) so the public source
 * never itself names what it bans; an optional plaintext `tokens` array is
 * honored for forks that prefer readable lists. Word tokens match with
 * boundaries (a short brand token never trips on a longer word containing it);
 * host-shaped tokens match label-aligned inside domains and emails. NOTHING
 * committed is exempt by directory — this repo is public, so build scaffolding
 * under docs/ leaks exactly like a skill file. Only the config (which may hold
 * plaintext tokens in a fork) and this validator remain file-exempt.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findBannedTokens, findBannedTokenHashes } = require('./lib/text-scan');

const ROOT = path.join(__dirname, '..', '..');
const BANNED_FILE = path.join(ROOT, 'config', 'banned-company-tokens.json');

const SCAN_EXTS = new Set([
  '.md', '.mdx', '.txt', '.js', '.cjs', '.mjs', '.json', '.jsonl', '.yml', '.yaml', '.sh', '.toml', '.example',
]);
const EXEMPT_FILES = new Set([
  'config/banned-company-tokens.json',
  'scripts/ci/validate-no-company-tokens.js',
]);

function loadBanned() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8'));
    return {
      tokens: Array.isArray(parsed && parsed.tokens)
        ? parsed.tokens.filter(t => typeof t === 'string' && t.trim())
        : [],
      hashes: Array.isArray(parsed && parsed.token_hashes)
        ? parsed.token_hashes.filter(h => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h.trim()))
        : [],
    };
  } catch (_err) {
    return { tokens: [], hashes: [] };
  }
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

function main() {
  const { tokens, hashes } = loadBanned();
  if (!tokens.length && !hashes.length) {
    console.log('validate-no-company-tokens: no token list configured — nothing to scan.');
    process.exit(0);
  }

  let files;
  try {
    files = trackedFiles();
  } catch (err) {
    // No git context (e.g. an unpacked tarball) — skip rather than false-fail.
    console.log(`validate-no-company-tokens: SKIP (git unavailable: ${err.message})`);
    process.exit(0);
  }

  let failures = 0;
  let scanned = 0;
  for (const rel of files) {
    if (EXEMPT_FILES.has(rel)) continue;
    if (!SCAN_EXTS.has(path.extname(rel).toLowerCase())) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch (_err) {
      continue;
    }
    scanned += 1;
    const hits = [...new Set([
      ...findBannedTokens(content, tokens).map(h => h.toLowerCase()),
      ...findBannedTokenHashes(content, hashes),
    ])];
    if (hits.length) {
      console.error(`ERROR: banned company token(s) ${hits.map(h => `"${h}"`).join(', ')} in committed file ${rel}`);
      failures += hits.length;
    }
  }

  if (failures > 0) {
    console.error(`validate-no-company-tokens: FAIL (${failures} hit${failures === 1 ? '' : 's'}). Company data belongs only in your gitignored workspace (~/.claude/escc/), never in committed example/seed data.`);
    process.exit(1);
  }

  console.log(`Validated: no banned company tokens in committed data (${scanned} files scanned).`);
  process.exit(0);
}

main();
