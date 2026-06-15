#!/usr/bin/env node
/* ESCC deliverables-location — nudge stray generated docs into deliverables/ (NEW for ESCC). */

/*
 * PostToolUse hook (matcher Write; profiles standard,strict).
 *
 * When a Write creates a doc-like file (.md/.txt/.pdf/.docx/.csv/.html) that is
 * NOT already under a deliverables/ path AND is NOT a clearly-structural repo
 * file (skills/, agents/, commands/, rules/, docs/, scripts/, tests/, schemas/,
 * hooks/, README/CHANGELOG/LICENSE/CLAUDE/AGENTS/SOUL, .github/), it returns a
 * non-blocking {additionalContext} suggesting the file belongs under
 * deliverables/<category>/. Otherwise it returns undefined.
 *
 * Pure warn — never blocks. Synchronous, fails open on any error.
 */

'use strict';

const path = require('path');
const { parseHookInput, getToolInput, getFilePath } = require('../lib/hook-input');

// Generated-artifact extensions worth nudging into deliverables/.
const DOC_EXT = /\.(md|txt|pdf|docx?|csv|html?)$/i;

// Structural repo directories — files here are part of the plugin, not deliverables.
const STRUCTURAL_DIRS = /(^|\/)(skills|agents|commands|rules|contexts|docs|scripts|tests|schemas|hooks|manifests|mcp-configs|config|assets|node_modules|\.github|\.claude|\.claude-plugin|\.git)\//i;

// Structural repo files (by basename, sans extension), allowed anywhere.
const STRUCTURAL_BASENAMES = /^(README|CHANGELOG|LICENSE|CLAUDE|AGENTS|SOUL|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|NOTICE|VERSION)$/i;

function normalize(p) {
  return String(p || '').replace(/\\/g, '/');
}

function isUnderDeliverables(filePath) {
  return /(^|\/)deliverables\//i.test(normalize(filePath));
}

function isStructural(filePath) {
  const norm = normalize(filePath);
  if (STRUCTURAL_DIRS.test(norm)) return true;
  const base = path.posix.basename(norm);
  const stem = base.replace(/\.[^.]+$/, '');
  return STRUCTURAL_BASENAMES.test(stem);
}

/** Should this Write be nudged toward deliverables/? */
function isStrayDoc(filePath) {
  const norm = normalize(filePath);
  if (!norm) return false;
  if (!DOC_EXT.test(norm)) return false;
  if (isUnderDeliverables(norm)) return false;
  if (isStructural(norm)) return false;
  return true;
}

/**
 * @param {string|object} raw
 * @param {object} [ctx]
 * @returns {{additionalContext:string}|undefined}
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const toolInput = getToolInput(input);
    const filePath = getFilePath(toolInput);
    if (!filePath || !isStrayDoc(filePath)) return undefined;

    const base = path.posix.basename(normalize(filePath));
    return {
      additionalContext:
        `📁 deliverables-location: "${base}" looks like a generated artifact written outside the deliverables/ structure. ` +
        'Generated docs belong under deliverables/<category>/ — for example deliverables/outbound/ (sequences, emails), ' +
        'deliverables/research/ (account/lead research), or deliverables/reports/ (pipeline/forecast reports). ' +
        'Move it there so it is easy to find, share, and clean up.',
    };
  } catch (_err) {
    return { exitCode: 0 }; // fail open on internal error
  }
}

module.exports = { run, isStrayDoc, isStructural, isUnderDeliverables };

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  let result;
  try { result = run(raw, {}); } catch (_err) { result = { exitCode: 0 }; }
  if (result && typeof result.additionalContext === 'string') {
    process.stdout.write(`${result.additionalContext}\n`);
  } else {
    process.stdout.write(raw);
  }
  process.exit(0); // warn-only: always pass through
}
