#!/usr/bin/env node
/*
 * pre:outbound-send-gate — the ONE fail-CLOSED hook in ESCC (NEW for ESCC).
 *
 * Trust boundary, not a prompt: a live outbound send is blocked unless a
 * review-evidence marker is recorded in the state store, and bulk sends are
 * capped by ESCC_BULK_SEND_MAX. On ANY doubt — truncated input, unparseable
 * payload, missing config, internal error — this hook BLOCKS (exit 2). Gmail is
 * draft-only by construction; this gate covers every other send-capable tool.
 *
 * Escape hatch: ESCC_OUTBOUND_GATE=off (documented as dangerous).
 *
 * Return contract (run-with-flags): { exitCode: 2, stderr } blocks; undefined
 * passes through.
 */

'use strict';

const {
  parseHookInput,
  getToolName,
  getToolInput,
  getSessionId,
} = require('../lib/hook-input');
const review = require('../lib/outbound-review');

function block(reason) {
  return { exitCode: 2, stderr: `[outbound-send-gate] BLOCKED: ${reason}` };
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean, pluginRoot?: string}} [ctx]
 * @returns {{exitCode:number, stderr:string}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    // Documented dangerous escape hatch — only path that opens the gate wholesale.
    if (review.isGateOff()) {
      return undefined;
    }

    // Fail closed on a truncated payload: we cannot verify a review on a send
    // we cannot fully see.
    if (ctx && ctx.truncated) {
      return block('hook input was truncated; cannot verify outbound review (fail-closed). Retry or set ESCC_OUTBOUND_GATE=off to override.');
    }

    const input = parseHookInput(raw);
    const toolName = getToolName(input);

    // The matcher scopes this hook to send-capable tools. If we cannot even
    // identify the tool, we cannot prove this is NOT a live send → block.
    if (!toolName) {
      return block('could not identify the tool being called; refusing to assume it is safe (fail-closed).');
    }

    const config = review.loadOutboundToolsConfig(ctx.pluginRoot);
    const klass = review.classifyTool(toolName, config);

    // Allow-listed (draft/read) or unrelated tools pass straight through.
    if (klass !== 'send') {
      return undefined;
    }

    // --- it is a LIVE SEND: enforce bulk cap, then require review evidence ---
    const sessionId = getSessionId(input);
    const toolInput = getToolInput(input);
    const fingerprint = review.fingerprintOutbound(toolName, toolInput);

    const max = review.bulkMax();
    const alreadySent = review.countSends({ sessionId });
    if (alreadySent >= max) {
      review.recordSendDecision({ sessionId, fingerprint, decision: 'bulk' });
      return block(`bulk send cap reached (${alreadySent}/${max} sends this session via ESCC_BULK_SEND_MAX). Split the work across sessions or raise the cap deliberately.`);
    }

    const marker = review.findValidReview({ fingerprint, minConfidence: review.reviewMinConfidence() });
    if (!marker) {
      review.recordSendDecision({ sessionId, fingerprint, decision: 'unapproved' });
      return block(`no review-evidence marker for this outbound (tool=${toolName}). Run the outbound-review flow first so the draft is reviewed and approved, then retry the send.`);
    }

    // Approved + under the cap: record the send (advances the bulk counter) and allow.
    review.recordSendDecision({ sessionId, fingerprint, decision: 'allow' });
    return undefined;
  } catch (err) {
    // FAIL CLOSED on any unexpected error.
    return block(`internal error, blocking send to stay safe: ${err && err.message ? err.message : String(err)}`);
  }
}

module.exports = { run };

// Standalone fallback (legacy spawn path). Guarded so that require()-ing this
// module from run-with-flags never registers stdin listeners or exits. Stays
// fail-closed: any error here still blocks.
if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_err) {
    raw = '';
  }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try {
    result = run(raw, { truncated, pluginRoot: process.env.ESCC_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT });
  } catch (err) {
    result = { exitCode: 2, stderr: `[outbound-send-gate] BLOCKED: internal error (fail-closed): ${err && err.message}` };
  }
  if (result && result.exitCode === 2) {
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exit(2);
  }
  process.stdout.write(raw);
  process.exit(0);
}
