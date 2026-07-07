#!/usr/bin/env node
'use strict';

/*
 * Anti-leak guard: no real email address in COMMITTED data (CLAUDE.md §4/§5).
 *
 * Every email address in a git-tracked text file must use a fixture domain
 * from config/committed-email-domains.json (or a subdomain of one) or an
 * RFC 2606 reserved TLD (.example/.test/.invalid/.localhost). A real
 * prospect / customer / colleague address failing CI is the point: example,
 * seed, demo, and test data must stay synthetic, and admitting a new fixture
 * domain is a deliberate, reviewable config change — never an accident.
 *
 * Scans only git-TRACKED files (via `git ls-files`), so it never false-fails
 * on gitignored runtime data (~/.claude/escc/...), which legitimately holds
 * real recipient addresses in a private workspace. Nothing committed is
 * exempt by directory — this repo is public.
 */

const fs = require('fs');
const path = require('path');
const { findForeignEmails, listTrackedFiles } = require('./lib/text-scan');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWLIST_FILE = path.join(ROOT, 'config', 'committed-email-domains.json');

const SCAN_EXTS = new Set([
  '.md', '.mdx', '.txt', '.js', '.cjs', '.mjs', '.json', '.jsonl', '.yml', '.yaml', '.sh', '.toml', '.example',
]);
const EXEMPT_FILES = new Set([
  'tests/unit/ci-security-scans.test.js', // exercises the scanner with deliberately-foreign fixture addresses
]);

function loadAllowedDomains() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.allowed_domains)) {
      return parsed.allowed_domains.filter(d => typeof d === 'string' && d.trim());
    }
  } catch (_err) { /* fall through */ }
  return [];
}

function main() {
  let files;
  try {
    files = listTrackedFiles(ROOT);
  } catch (err) {
    // No git context (e.g. an unpacked tarball) — skip rather than false-fail.
    console.log(`validate-committed-emails: SKIP (git unavailable: ${err.message})`);
    process.exit(0);
  }

  const allowed = loadAllowedDomains();
  let failures = 0;
  let scanned = 0;
  for (const rel of files) {
    if (EXEMPT_FILES.has(rel)) continue;
    const ext = path.extname(rel).toLowerCase();
    if (!SCAN_EXTS.has(ext) && path.basename(rel) !== '.env.example') continue;
    let content;
    try {
      content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch (_err) {
      continue;
    }
    scanned += 1;
    for (const leak of [...new Set(findForeignEmails(content, allowed))]) {
      console.error(`ERROR: non-fixture email address "${leak}" in committed file ${rel}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`validate-committed-emails: FAIL (${failures} address${failures === 1 ? '' : 'es'}). Use a fixture domain from config/committed-email-domains.json (or an .example address); real recipient data belongs only in your gitignored workspace.`);
    process.exit(1);
  }

  console.log(`Validated: no non-fixture email addresses in committed data (${scanned} files scanned).`);
  process.exit(0);
}

main();
