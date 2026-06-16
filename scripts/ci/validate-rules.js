#!/usr/bin/env node
'use strict';

/*
 * Validate rules/*.md (CLAUDE.md §2).
 *
 * The base layer is rules/common/. Every overlay file (any rule in a
 * subdirectory other than common/ — meddpicc/, segments/, jurisdictions/) must
 * open with the line:
 *   This file extends [common/<file>.md](../common/<file>.md) with ...
 * and the referenced common/ counterpart must exist.
 *
 * Hard errors: empty rule file, a missing/malformed overlay opener, or an
 * extends-reference to a missing common file. Soft finding: curly quotes.
 */

const fs = require('fs');
const path = require('path');
const { createReporter } = require('./lib/report');
const { CURLY_QUOTE_RE } = require('./lib/text-scan');

const ROOT = path.join(__dirname, '..', '..');
const RULES_DIR = path.join(ROOT, 'rules');
const COMMON_DIR = path.join(RULES_DIR, 'common');

// First-line opener for an overlay. Group 2 is the common/ target filename.
const EXTENDS_RE = /^This file extends \[common\/[^\]]+\.md\]\((?:\.\.\/)?common\/([^)]+\.md)\) with /;

function collectRuleFiles(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRuleFiles(abs, base, out);
    else if (entry.name.endsWith('.md')) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
}

function main() {
  const reporter = createReporter('validate-rules');
  if (!fs.existsSync(RULES_DIR)) {
    console.log('No rules directory found, skipping');
    process.exit(0);
  }

  const files = [];
  collectRuleFiles(RULES_DIR, RULES_DIR, files);

  for (const relInRules of files.sort()) {
    const rel = `rules/${relInRules}`;
    const content = fs.readFileSync(path.join(RULES_DIR, relInRules), 'utf8');
    if (content.trim().length === 0) { reporter.error(rel, 'empty rule file'); continue; }

    const topDir = relInRules.includes('/') ? relInRules.split('/')[0] : '';
    const isOverlay = topDir && topDir !== 'common';
    if (isOverlay) {
      const firstLine = content.split('\n')[0] || '';
      const match = firstLine.match(EXTENDS_RE);
      if (!match) {
        reporter.error(rel, 'overlay must open with "This file extends [common/<file>.md](../common/<file>.md) with ..."');
      } else if (!fs.existsSync(path.join(COMMON_DIR, match[1]))) {
        reporter.error(rel, `extends a missing common counterpart: common/${match[1]}`);
      }
    }

    if (CURLY_QUOTE_RE.test(content)) reporter.finding(rel, 'contains curly quotes');
  }

  reporter.finish(`Validated ${files.length} rule files`);
}

main();
