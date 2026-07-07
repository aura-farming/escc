#!/usr/bin/env node
'use strict';

/*
 * Secret-scan guard: no committed credentials (CLAUDE.md §4 — "never hardcode
 * secrets"; open-source-readiness ADR, E1). Catches high-confidence credential
 * signatures (AWS keys, private-key blocks, GitHub/Slack/Google/Stripe/Twilio
 * tokens, and a placeholder-filtered secret=value assignment) before they reach
 * the public source.
 *
 * Scans only git-TRACKED files (via `git ls-files`), so it never reads .env or
 * other gitignored local secrets — those are SUPPOSED to hold real values and
 * are correctly excluded. .env.example / mcp-configs ship placeholders only and
 * are scanned. CI output prints the secret TYPE and a truncated match, never the
 * full credential.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findSecrets } = require('./lib/text-scan');

const ROOT = path.join(__dirname, '..', '..');

const SCAN_EXTS = new Set([
  '.md', '.mdx', '.txt', '.js', '.cjs', '.mjs', '.json', '.jsonl', '.yml', '.yaml', '.sh', '.toml', '.example', '.env',
]);
const EXEMPT_FILES = new Set([
  'scripts/ci/lib/text-scan.js',        // defines the signatures
  'scripts/ci/validate-no-secrets.js',  // this file
  'tests/unit/ci-security-scans.test.js', // exercises the signatures with fixtures
]);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

function main() {
  let files;
  try {
    files = trackedFiles();
  } catch (err) {
    console.log(`validate-no-secrets: SKIP (git unavailable: ${err.message})`);
    process.exit(0);
  }

  let failures = 0;
  let scanned = 0;
  for (const rel of files) {
    if (EXEMPT_FILES.has(rel)) continue;
    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel);
    if (!SCAN_EXTS.has(ext) && base !== '.env.example') continue;
    let content;
    try {
      content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch (_err) {
      continue;
    }
    scanned += 1;
    for (const hit of findSecrets(content)) {
      console.error(`ERROR: possible committed secret (${hit.type}: ${hit.match}) in ${rel}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`validate-no-secrets: FAIL (${failures} possible secret${failures === 1 ? '' : 's'}). Move credentials to a gitignored .env and reference them as placeholders.`);
    process.exit(1);
  }

  console.log(`Validated: no committed secrets (${scanned} files scanned).`);
  process.exit(0);
}

main();
