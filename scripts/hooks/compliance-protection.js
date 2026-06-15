#!/usr/bin/env node
/*
 * pre:compliance-protection — adapted from ECC scripts/hooks/config-protection.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 *
 * ECC blocked edits to linter/formatter configs (so agents fix code, not the
 * config). ESCC re-points the same guard at COMPLIANCE-bearing files: an agent
 * must not silently weaken outbound-compliance rules, data-handling/PII rules,
 * lawful-basis, jurisdiction overlays, or strip the unsubscribe/identity block
 * from an outreach sequence. Compliance changes go through a human, not an edit.
 *
 * Failure policy: fails OPEN on internal error (exit 0); BLOCKS (exit 2) edits
 * to a protected compliance file and refuses to evaluate a truncated payload it
 * cannot verify.
 */

'use strict';

const path = require('path');
const { parseHookInput, getToolInput, getFilePath } = require('../lib/hook-input');

// Compliance RULE files: protected only when they live under a rules/ tree, so
// an unrelated user file named data-handling.md elsewhere is not affected.
const COMPLIANCE_RULE_FILES = new Set([
  'outbound-compliance.md',
  'data-handling.md',
  'lawful-basis.md',
  'jurisdiction-routing.md',
  'approval-matrix.md',
]);

// Always-protected by basename regardless of directory.
const ALWAYS_PROTECTED = new Set([
  'the-compliance-guide.md',
]);

function normalize(p) {
  return String(p || '').replace(/\\/g, '/');
}

/** Is this path a protected compliance file? */
function isProtected(filePath) {
  const norm = normalize(filePath);
  if (!norm) return false;
  const base = path.posix.basename(norm);
  if (ALWAYS_PROTECTED.has(base)) return true;
  if (norm.includes('/rules/jurisdictions/') || norm.startsWith('rules/jurisdictions/')) return true;
  if (COMPLIANCE_RULE_FILES.has(base) && /(^|\/)rules\//.test(norm)) return true;
  return false;
}

const SEQUENCE_PATH = /(^|\/)(sequences|outbound)\//;
const UNSUBSCRIBE_TOKENS = /(unsubscribe|opt[\s-]?out|\{\{\s*unsubscribe)/i;

/** Does this look like an outreach sequence file? */
function isSequenceFile(filePath) {
  const norm = normalize(filePath);
  return SEQUENCE_PATH.test(norm) && /\.(md|txt|json|ya?ml|html?)$/i.test(norm);
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean}} [ctx]
 * @returns {{exitCode:number, stderr?:string}|{additionalContext:string}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    if (ctx && ctx.truncated) {
      return {
        exitCode: 2,
        stderr: '[compliance-protection] BLOCKED: hook input was truncated; cannot verify the edit does not target a protected compliance file. Retry with a smaller edit.',
      };
    }

    const input = parseHookInput(raw);
    const toolInput = getToolInput(input);
    const filePath = getFilePath(toolInput);
    if (!filePath) return undefined;

    if (isProtected(filePath)) {
      return {
        exitCode: 2,
        stderr:
          `[compliance-protection] BLOCKED: ${path.posix.basename(normalize(filePath))} is a compliance-bearing file and is protected from agent edits. ` +
          'Compliance rules (unsubscribe/identity/consent, PII handling, lawful basis, jurisdiction routing, approval matrix) must be changed by a human, not weakened to pass a check. ' +
          'Propose the change to the deal/RevOps owner instead.',
      };
    }

    // Sequence files: warn (do not block) if the new content lacks an
    // unsubscribe/opt-out block — a missing footer is a compliance risk.
    if (isSequenceFile(filePath)) {
      const newContent = toolInput.content || toolInput.new_string || '';
      if (newContent && !UNSUBSCRIBE_TOKENS.test(String(newContent))) {
        return {
          additionalContext:
            `⚠️ compliance-protection: this outreach sequence file (${path.posix.basename(normalize(filePath))}) has no unsubscribe/opt-out block in the edited content. ` +
            'Bulk/commercial email must carry a working unsubscribe path and sender identity (AU Spam Act 2003 / CAN-SPAM / PECR). Add one before this sequence is used.',
        };
      }
    }

    return undefined;
  } catch (_err) {
    return { exitCode: 0 }; // fail open on internal error
  }
}

module.exports = { run, isProtected, isSequenceFile };

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try { result = run(raw, { truncated }); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  if (result && result.exitCode === 2) process.exit(2);
  process.stdout.write(raw);
  process.exit(0);
}
