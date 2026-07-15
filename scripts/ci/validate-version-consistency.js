#!/usr/bin/env node
'use strict';

/*
 * Validate that every version-bearing release surface agrees with package.json.
 *
 * A release bump touches SEVEN files — package.json, .claude-plugin/plugin.json,
 * .claude-plugin/marketplace.json, CLAUDE.md, SOUL.md, AGENTS.md, agent.yaml —
 * and the non-JSON ones are easy to miss by hand (they have been). A skewed
 * surface ships a wrong version to the marketplace or the docs, so CI pins
 * them together here: any mismatch (or an extractor that stops matching after
 * a doc rewrite) fails the build.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** Each surface with its version extractor (returns the string or null). */
const SURFACES = [
  ['package.json', txt => JSON.parse(txt).version || null],
  ['.claude-plugin/plugin.json', txt => JSON.parse(txt).version || null],
  ['.claude-plugin/marketplace.json', txt => {
    const parsed = JSON.parse(txt);
    const plugin = (parsed.plugins || []).find(p => p && p.version);
    return (plugin && plugin.version) || parsed.version || null;
  }],
  ['CLAUDE.md', txt => (txt.match(/Version `(\d+\.\d+\.\d+)`/) || [])[1] || null],
  ['SOUL.md', txt => (txt.match(/`escc` · v(\d+\.\d+\.\d+)/) || [])[1] || null],
  ['AGENTS.md', txt => (txt.match(/`escc` v(\d+\.\d+\.\d+)/) || [])[1] || null],
  ['agent.yaml', txt => (txt.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m) || [])[1] || null],
];

function main() {
  const errors = [];
  const found = [];
  let canonical = null;

  for (const [rel, extract] of SURFACES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`${rel}: version surface missing from the repo`);
      continue;
    }
    let version = null;
    try {
      version = extract(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      errors.push(`${rel}: unreadable (${err.message})`);
      continue;
    }
    if (!version) {
      errors.push(`${rel}: no version string found (the extractor pattern may have rotted — update SURFACES here alongside the doc)`);
      continue;
    }
    found.push([rel, version]);
    if (rel === 'package.json') canonical = version;
  }

  for (const [rel, version] of found) {
    if (canonical && version !== canonical) {
      errors.push(`${rel} says ${version} but package.json says ${canonical} — bump every surface together`);
    }
  }

  if (errors.length > 0) {
    for (const err of errors) console.error(`ERROR: ${err}`);
    console.error(`validate-version-consistency: FAIL (${errors.length} error${errors.length === 1 ? '' : 's'})`);
    process.exit(1);
  }
  console.log(`Validated ${found.length} version surfaces — all agree at ${canonical}`);
  process.exit(0);
}

main();
