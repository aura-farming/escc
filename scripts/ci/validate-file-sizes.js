#!/usr/bin/env node
'use strict';

/*
 * Enforce the CLAUDE.md §4 machinery cap: every .js file under scripts/ stays
 * <= 800 lines ("prefer many small focused modules over few large ones"). The
 * operator-CLI dispatcher and the state-store query layer had both silently
 * drifted past the cap before v1.10.0; this pins the rule so future growth
 * forces a split instead of a bigger file. (Content-plane caps live in their
 * own validators: skills <= 800 lines in validate-skills, commands <= 20
 * non-frontmatter lines in validate-commands.)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MAX_LINES = 800;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) yield full;
  }
}

function main() {
  const errors = [];
  for (const file of walk(path.join(ROOT, 'scripts'))) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    if (lines > MAX_LINES) {
      errors.push(`${path.relative(ROOT, file)}: ${lines} lines (cap ${MAX_LINES}) — split it into focused modules`);
    }
  }

  if (errors.length > 0) {
    for (const err of errors) console.error(`ERROR: ${err}`);
    console.error(`validate-file-sizes: FAIL (${errors.length} error${errors.length === 1 ? '' : 's'})`);
    process.exit(1);
  }
  console.log(`Validated scripts/**/*.js — every file under the ${MAX_LINES}-line cap`);
  process.exit(0);
}

main();
