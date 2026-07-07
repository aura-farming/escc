#!/usr/bin/env node
/*
 * ESCC post:outcome-capture — feed the outcomes ledger from real tool calls
 * (NEW for ESCC; the v1.8.0 learning-loop keystone).
 *
 * When a HubSpot deal-stage write or a Calendar event creation succeeds, the
 * outcome lands in the state-store outcomes ledger, which the instinct
 * engine's SessionEnd distillation reads to move instinct confidence on REAL
 * results (distill.applyOutcomeWeighting, I2). Classification + payload
 * sanitation live in scripts/lib/outcome-capture.js.
 *
 * Failure policy: PURE OBSERVER — never blocks, never injects context, skips
 * errored tool calls, fails OPEN (exit 0) on any internal error.
 */
/**
 * post:outcome-capture
 *   matcher: mcp__hubspot__manage_crm_objects | Google_Calendar create_event
 *   profiles: minimal, standard, strict (learning-critical, harmless)
 */

'use strict';

const fs = require('fs');
const { parseHookInput, getToolName, getToolInput, getSessionId } = require('../lib/hook-input');
const outcomeCapture = require('../lib/outcome-capture');

function toolErrored(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.tool_error === true || input.is_error === true) return true;
  const resp = input.tool_response;
  if (resp && typeof resp === 'object' && resp.is_error === true) return true;
  return false;
}

/**
 * @param {string|object} raw PostToolUse event JSON
 * @param {{truncated?: boolean}} [ctx]
 * @returns {{exitCode:number}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    const input = parseHookInput(raw);
    if (toolErrored(input)) return undefined; // a failed write is not an outcome
    // A truncated payload can't be classified trustworthily — skip.
    if (ctx && ctx.truncated) return undefined;
    outcomeCapture.capture({
      toolName: getToolName(input),
      toolInput: getToolInput(input),
      sessionId: getSessionId(input),
    });
    return undefined; // silent observer — no context injected
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — learning must never block work
  }
}

module.exports = { run, toolErrored };

if (require.main === module) {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_err) {
    raw = '';
  }
  try {
    run(raw, {});
  } catch (_err) {
    /* fail open */
  }
  process.stdout.write(raw);
  process.exit(0);
}
