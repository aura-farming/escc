#!/usr/bin/env node
'use strict';

/*
 * Prevent shipping user-specific absolute paths (CLAUDE.md §4/§5).
 *
 * Scans EVERY git-tracked text file for `/Users/<name>`, `/home/<name>`, and
 * `C:\Users\<name>` paths, allowing obvious placeholder usernames used in
 * templates/examples. Nothing committed is exempt: this repo is public, so a
 * root-level doc, a release note, an example, or internal build scaffolding
 * leaks exactly as loudly as a skill file — a scan allowlist misses exactly
 * the files nobody thinks to check (the v1.8.1 lesson). When git is
 * unavailable (an unpacked tarball), falls back to walking the whole tree.
 */

const fs = require('fs');
const path = require('path');
const { findPersonalPaths, listTrackedFiles, walkFiles } = require('./lib/text-scan');

const ROOT = path.join(__dirname, '..', '..');

const SCAN_EXTS = new Set([
  '.md', '.mdx', '.txt', '.js', '.cjs', '.mjs', '.json', '.jsonl', '.yml', '.yaml', '.sh', '.toml', '.example', '.svg',
]);

function repoRelative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function filesToScan() {
  try {
    return listTrackedFiles(ROOT).map(rel => path.join(ROOT, rel));
  } catch (_err) {
    // No git context (e.g. an unpacked tarball) — scan the whole tree instead.
    return walkFiles(ROOT, { exts: SCAN_EXTS });
  }
}

function main() {
  let failures = 0;
  let scanned = 0;
  for (const file of filesToScan()) {
    const rel = repoRelative(file);
    const ext = path.extname(rel).toLowerCase();
    if (!SCAN_EXTS.has(ext) && path.basename(rel) !== '.env.example') continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_err) {
      continue;
    }
    scanned += 1;
    for (const leak of findPersonalPaths(content)) {
      console.error(`ERROR: personal path "${leak}" detected in ${rel}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`validate-no-personal-paths: FAIL (${failures} leak${failures === 1 ? '' : 's'})`);
    process.exit(1);
  }

  console.log(`Validated: no personal absolute paths (${scanned} files scanned)`);
  process.exit(0);
}

main();
