#!/usr/bin/env node
'use strict';

/*
 * Validate skills/<name>/SKILL.md structure (CLAUDE.md §2).
 *
 * Hard errors: missing/empty SKILL.md, missing frontmatter, name != directory,
 * missing description, missing origin, a missing required section, or >800 lines.
 * Soft findings (warn by default, error under strict): an origin outside the
 * {ESCC, ECC-adapted} set, or curly quotes.
 *
 * Unicode and personal-path safety are owned by the dedicated repo-wide scanners.
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./lib/frontmatter');
const { createReporter } = require('./lib/report');
const { CURLY_QUOTE_RE } = require('./lib/text-scan');

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');
const MAX_LINES = 800;

// `description` is written as trigger conditions and is the routing surface, so
// it must be present. Section presence is matched loosely (heading wording
// varies) — the same checks the content was authored against.
const REQUIRED_SECTIONS = [
  { label: 'When to Activate', re: /when to activate/i },
  { label: 'workflow / steps', re: /workflow|steps|how it works|process/i },
  { label: 'examples', re: /example/i },
  { label: 'anti-patterns', re: /anti-pattern/i },
];

function main() {
  const reporter = createReporter('validate-skills');
  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('No skills directory found, skipping');
    process.exit(0);
  }

  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name);

  let validated = 0;
  for (const dir of dirs) {
    const rel = `skills/${dir}/SKILL.md`;
    const file = path.join(SKILLS_DIR, dir, 'SKILL.md');

    if (!fs.existsSync(file)) { reporter.error(rel, 'missing SKILL.md'); continue; }
    const content = fs.readFileSync(file, 'utf8');
    if (content.trim().length === 0) { reporter.error(rel, 'empty SKILL.md'); continue; }

    const fm = parseFrontmatter(content);
    if (!fm.present) { reporter.error(rel, 'missing frontmatter'); continue; }
    for (const dup of new Set(fm.duplicates)) reporter.error(rel, `duplicate frontmatter key: ${dup}`);

    const name = fm.values.name;
    if (!name) reporter.error(rel, 'frontmatter missing required field: name');
    else if (name !== dir) reporter.error(rel, `frontmatter name "${name}" != directory "${dir}"`);

    if (!fm.values.description) reporter.error(rel, 'frontmatter missing required field: description');
    else if (fm.indicators.description === '|') {
      reporter.finding(rel, "description uses a literal '|' block scalar (preserves newlines); use an inline or folded '>' scalar");
    }

    const origin = fm.values.origin;
    if (!origin) reporter.error(rel, 'frontmatter missing required field: origin');
    else if (!/ESCC|ECC-adapted/.test(origin)) reporter.finding(rel, `origin "${origin}" is not one of ESCC | ECC-adapted`);

    for (const section of REQUIRED_SECTIONS) {
      if (!section.re.test(content)) reporter.error(rel, `missing required section: ${section.label}`);
    }

    const lines = content.split('\n').length;
    if (lines > MAX_LINES) reporter.error(rel, `${lines} lines exceeds ${MAX_LINES} max`);

    if (CURLY_QUOTE_RE.test(content)) reporter.finding(rel, 'contains curly quotes');

    validated += 1;
  }

  reporter.finish(`Validated ${validated} skill directories`);
}

main();
