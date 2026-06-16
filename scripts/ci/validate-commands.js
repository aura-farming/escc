#!/usr/bin/env node
'use strict';

/*
 * Validate commands/*.md thin-shim contract (CLAUDE.md §2).
 *
 * A command is a thin shim: frontmatter (description + argument-hint), an
 * `$ARGUMENTS` passthrough, the line "Apply the `<skill>` skill", and 2-3 scope
 * notes — no logic.
 *
 * Hard errors: empty file, missing frontmatter, missing description, >20
 * non-frontmatter lines, a missing/ dangling "Apply the `<skill>` skill"
 * delegation, or a reference to a non-existent agent.
 * Soft findings: missing argument-hint, curly quotes.
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./lib/frontmatter');
const { createReporter } = require('./lib/report');
const { CURLY_QUOTE_RE } = require('./lib/text-scan');

const ROOT = path.join(__dirname, '..', '..');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const SKILLS_DIR = path.join(ROOT, 'skills');
const AGENTS_DIR = path.join(ROOT, 'agents');
const MAX_BODY_LINES = 20;

function listSkillNames() {
  if (!fs.existsSync(SKILLS_DIR)) return new Set();
  return new Set(
    fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  );
}

function listAgentNames() {
  if (!fs.existsSync(AGENTS_DIR)) return new Set();
  return new Set(
    fs.readdirSync(AGENTS_DIR)
      .filter(file => file.endsWith('.md'))
      .map(file => file.replace(/\.md$/, ''))
  );
}

function main() {
  const reporter = createReporter('validate-commands');
  if (!fs.existsSync(COMMANDS_DIR)) {
    console.log('No commands directory found, skipping');
    process.exit(0);
  }

  const skills = listSkillNames();
  const agents = listAgentNames();
  const files = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith('.md'));

  for (const file of files) {
    const rel = `commands/${file}`;
    const content = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
    if (content.trim().length === 0) { reporter.error(rel, 'empty command file'); continue; }

    const fm = parseFrontmatter(content);
    if (!fm.present) {
      reporter.error(rel, 'missing frontmatter');
    } else {
      for (const dup of new Set(fm.duplicates)) reporter.error(rel, `duplicate frontmatter key: ${dup}`);
      if (!fm.values.description) reporter.error(rel, 'frontmatter missing required field: description');
      if (!('argument-hint' in fm.values)) reporter.finding(rel, 'frontmatter missing argument-hint');
    }

    const body = fm.present ? fm.body : content;
    const bodyLines = body.replace(/\n+$/, '').split('\n').length;
    if (bodyLines > MAX_BODY_LINES) {
      reporter.error(rel, `${bodyLines} non-frontmatter lines exceeds ${MAX_BODY_LINES} max (commands are thin shims)`);
    }

    const normalized = content.replace(/\s+/g, ' ');
    const applyMatch = normalized.match(/Apply the `([^`]+)` skill/);
    if (!applyMatch) {
      reporter.error(rel, 'missing the "Apply the `<skill>` skill" delegation line');
    } else if (!skills.has(applyMatch[1])) {
      reporter.error(rel, `delegates to non-existent skill "${applyMatch[1]}"`);
    }

    const noCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
    for (const match of noCodeBlocks.matchAll(/agents\/([a-z][-a-z0-9]*)\.md/g)) {
      if (!agents.has(match[1])) reporter.error(rel, `references non-existent agent agents/${match[1]}.md`);
    }

    if (CURLY_QUOTE_RE.test(content)) reporter.finding(rel, 'contains curly quotes');
  }

  reporter.finish(`Validated ${files.length} command files`);
}

main();
