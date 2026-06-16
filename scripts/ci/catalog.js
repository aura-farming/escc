#!/usr/bin/env node
'use strict';

/*
 * Component-surface catalog, CI-pinned into README.md between the
 * <!-- ESCC:CATALOG:START --> / <!-- ESCC:CATALOG:END --> markers (CLAUDE.md §6).
 * Do not hand-edit the pinned counts — run the updater so the pin and the actual
 * counts stay in sync.
 *
 * Usage:
 *   node scripts/ci/catalog.js --text          # print counts            (npm run catalog)
 *   node scripts/ci/catalog.js --check --text  # verify README is in sync (npm run catalog:check)
 *   node scripts/ci/catalog.js --write --text  # rewrite the README block (npm run catalog:write)
 *   node scripts/ci/catalog.js --json          # print counts as JSON
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const README_PATH = path.join(ROOT, 'README.md');
const START_MARKER = '<!-- ESCC:CATALOG:START -->';
const END_MARKER = '<!-- ESCC:CATALOG:END -->';

function countSkills() {
  const dir = path.join(ROOT, 'skills');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .length;
}

function countMarkdown(relDir) {
  const dir = path.join(ROOT, relDir);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(file => file.endsWith('.md')).length;
}

function countRules() {
  const root = path.join(ROOT, 'rules');
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md')) total += 1;
    }
  })(root);
  return total;
}

function countHookMatchers() {
  const file = path.join(ROOT, 'hooks', 'hooks.json');
  if (!fs.existsSync(file)) return 0;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }
  const hooks = data.hooks || data;
  if (Array.isArray(hooks)) return hooks.length;
  let total = 0;
  for (const matchers of Object.values(hooks)) {
    if (Array.isArray(matchers)) total += matchers.length;
  }
  return total;
}

function collectCatalog() {
  return [
    { surface: 'Skills', count: countSkills() },
    { surface: 'Agents', count: countMarkdown('agents') },
    { surface: 'Commands', count: countMarkdown('commands') },
    { surface: 'Rules', count: countRules() },
    { surface: 'Hook matchers', count: countHookMatchers() },
  ];
}

function renderBlock(catalog) {
  const lines = ['| Surface | Count |', '| --- | --- |'];
  for (const row of catalog) lines.push(`| ${row.surface} | ${row.count} |`);
  lines.push('', '_Counts are generated and CI-pinned by `npm run catalog:write`. Do not edit by hand._');
  return lines.join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyToReadme(content, block) {
  const re = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`);
  if (!re.test(content)) {
    throw new Error(`README.md is missing the catalog markers (${START_MARKER} ... ${END_MARKER})`);
  }
  return content.replace(re, `${START_MARKER}\n${block}\n${END_MARKER}`);
}

function formatText(catalog) {
  return `ESCC catalog\n${catalog.map(row => `  ${row.surface}: ${row.count}`).join('\n')}\n`;
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  const json = argv.includes('--json');
  const text = argv.includes('--text');

  const catalog = collectCatalog();
  const block = renderBlock(catalog);

  if (json) {
    process.stdout.write(`${JSON.stringify({ catalog }, null, 2)}\n`);
    process.exit(0);
  }

  let content;
  try {
    content = fs.readFileSync(README_PATH, 'utf8');
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }

  if (write) {
    const updated = applyToReadme(content, block);
    if (updated !== content) {
      fs.writeFileSync(README_PATH, updated, 'utf8');
      console.log('Catalog written to README.md');
    } else {
      console.log('Catalog already up to date in README.md');
    }
  } else if (check) {
    let expected;
    try {
      expected = applyToReadme(content, block);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    }
    if (expected !== content) {
      console.error('ERROR: README.md catalog is out of date; run npm run catalog:write');
      process.exit(1);
    }
    console.log('Catalog is up to date.');
  }

  if (text) process.stdout.write(formatText(catalog));
  process.exit(0);
}

main();
