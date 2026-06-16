#!/usr/bin/env node
/*
 * ESCC observe-runner (NEW for ESCC; concept adapted from ECC
 * continuous-learning-v2's observe.sh — ESCC does a Node rewrite, deps = ajv only).
 *
 * pre:observe + post:observe — PreToolUse/PostToolUse hook (matcher *, all
 * profiles). The instinct engine's capture point: it appends one observation row
 * per tool-use event to the rep's workspace observations log, then PASSES THROUGH
 * (returns undefined; never blocks, never adds context). The append is a single
 * synchronous JSONL write — non-blocking in practice and trivially cheap.
 *
 * Failure policy: fail OPEN. Any internal error (bad payload, unwritable store)
 * returns undefined so the tool call proceeds unaffected.
 *
 * I3: observe.buildObservation tags untrusted-content tools untrusted:true and
 * never captures tool OUTPUT content; the distill step is what refuses to derive
 * instincts from untrusted observations.
 */

'use strict';

const fs = require('fs');

const { buildObservation } = require('../instincts/observe');
const { appendObservation } = require('../instincts/instinct-store');

/** Derive the compact 'pre'|'post' event tag from the dispatcher hook id. */
function eventFromHookId(hookId) {
  const id = String(hookId || '');
  if (id.startsWith('post:')) return 'post';
  if (id.startsWith('pre:')) return 'pre';
  return undefined; // let buildObservation fall back to hook_event_name
}

/**
 * @param {string|object} raw raw hook stdin
 * @param {{hookId?: string}} [ctx] dispatcher context (carries the hook id)
 * @returns {undefined} always pass-through
 */
function run(raw, ctx = {}) {
  try {
    const event = eventFromHookId(ctx && ctx.hookId);
    const observation = buildObservation(raw, event ? { event } : {});
    if (observation) appendObservation(observation);
  } catch (_err) {
    // Fail open — observation capture must never affect the tool call.
  }
  return undefined;
}

module.exports = { run, eventFromHookId };

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  try { run(raw, { hookId: process.env.ESCC_HOOK_ID || '' }); } catch (_err) { /* fail open */ }
  // Pure capture hook: never blocks, never rewrites — echo stdin through.
  process.stdout.write(raw);
  process.exit(0);
}
