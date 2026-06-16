#!/usr/bin/env node
'use strict';

/*
 * Prevent shipping user-specific absolute paths (CLAUDE.md §4/§5).
 *
 * Scans the content + machinery surfaces for `/Users/<name>`, `/home/<name>`,
 * and `C:\Users\<name>` paths, allowing obvious placeholder usernames used in
 * templates/examples. Internal build scaffolding under docs/superpowers/ is
 * exempt — those specs/plans/trackers legitimately reference the working tree
 * and are never part of the installed surface.
 */

const fs = require('fs');
const path = require('path');
const { findPersonalPaths, walkFiles } = require('./lib/text-scan');

const ROOT = path.join(__dirname, '..', '..');

const TARGETS = [
  'README.md', '.env.example',
  'skills', 'commands', 'agents', 'rules', 'docs', 'manifests', 'schemas',
  'contexts', 'config', 'mcp-configs', 'scripts', 'hooks', 'tests',
];

const SCAN_EXTS = new Set([
  '.md', '.mdx', '.txt', '.js', '.cjs', '.mjs', '.json', '.yml', '.yaml', '.sh', '.toml', '.example',
]);

const EXEMPT_PREFIXES = ['docs/superpowers/', 'docs/fixes/'];

function repoRelative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function main() {
  const files = [];
  for (const target of TARGETS) {
    const abs = path.join(ROOT, target);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) files.push(abs);
    else files.push(...walkFiles(abs, { exts: SCAN_EXTS }));
  }

  let failures = 0;
  let scanned = 0;
  for (const file of files) {
    const rel = repoRelative(file);
    if (EXEMPT_PREFIXES.some(prefix => rel.startsWith(prefix))) continue;
    scanned += 1;
    const content = fs.readFileSync(file, 'utf8');
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
