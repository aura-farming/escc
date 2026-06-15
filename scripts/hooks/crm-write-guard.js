#!/usr/bin/env node
/*
 * pre:crm-write-guard — guards HubSpot writes (NEW for ESCC).
 *
 * Fires on mcp__hubspot__manage_crm_objects. It:
 *   - WARNS on a delete/archive (deletes need approval and are audited);
 *   - checks a stage-advance write for a next-step + destination-stage
 *     exit-criteria field — WARN under standard, BLOCK under strict;
 *   - WARNS on a property/schema mutation (changing CRM structure, not data).
 *
 * Failure policy: fails OPEN (exit 0) on any error. Warnings are injected via
 * additionalContext so the model sees them; only strict-profile escalations block.
 */

'use strict';

const { parseHookInput, getToolInput } = require('../lib/hook-input');
const { getHookProfile } = require('../lib/hook-flags');

const DELETE_OPS = new Set(['delete', 'archive', 'remove', 'destroy']);
const STAGE_FIELDS = ['dealstage', 'hs_pipeline_stage', 'stage', 'pipeline_stage'];
const NEXT_STEP_FIELDS = ['hs_next_step', 'next_step', 'nextstep', 'next_activity', 'next_step_date'];

function lc(v) {
  return String(v == null ? '' : v).toLowerCase();
}

/** Pull the operation from the several field names HubSpot tools use. */
function getOperation(toolInput) {
  return lc(toolInput.operation || toolInput.action || toolInput.method || toolInput.op || '');
}

/** Collect the properties object from its field-name variants. */
function getProperties(toolInput) {
  const p = toolInput.properties || toolInput.props || toolInput.fields || toolInput.values;
  return p && typeof p === 'object' ? p : {};
}

function hasAnyKey(obj, keys) {
  const lowered = Object.keys(obj).map(k => k.toLowerCase());
  return keys.some(k => lowered.includes(k.toLowerCase()));
}

function warn(text) {
  return { additionalContext: `⚠️ crm-write-guard: ${text}` };
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean, profile?: string}} [ctx]
 * @returns {{exitCode:number, stderr?:string}|{additionalContext:string}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    if (ctx && ctx.truncated) return undefined; // fail open
    const profile = ctx.profile || getHookProfile();
    const strict = profile === 'strict';

    const input = parseHookInput(raw);
    const toolInput = getToolInput(input);
    const op = getOperation(toolInput);
    const props = getProperties(toolInput);
    const objectType = lc(toolInput.objectType || toolInput.object_type || toolInput.objectTypeId || '');

    // Property/schema mutation (changing CRM structure, not record data).
    if (/propert|schema|pipeline_definition/.test(objectType) || op === 'create_property' || op === 'update_property') {
      const msg = 'this looks like a CRM property/schema mutation (changing CRM structure, not record data). Confirm with RevOps before mutating the schema; this is logged.';
      return strict ? { exitCode: 2, stderr: `[crm-write-guard] BLOCKED (strict): ${msg}` } : warn(msg);
    }

    // Deletes/archives: warn (approval + audit), never silently proceed.
    if (DELETE_OPS.has(op)) {
      return warn(`a CRM ${op} was requested. Deletes/archives require approval and are audited — confirm this is intentional and logged before proceeding.`);
    }

    // Stage-advance writes: require a next step + exit-criteria fields.
    const isStageAdvance = hasAnyKey(props, STAGE_FIELDS);
    if (isStageAdvance && !hasAnyKey(props, NEXT_STEP_FIELDS)) {
      const msg = 'advancing a deal stage without a next step / destination-stage exit-criteria field. Set the next step (and any required exit-criteria fields) so the deal does not stall.';
      return strict
        ? { exitCode: 2, stderr: `[crm-write-guard] BLOCKED (strict): ${msg}` }
        : warn(msg);
    }

    return undefined;
  } catch (_err) {
    return { exitCode: 0 }; // fail open
  }
}

module.exports = { run, getOperation, getProperties };

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try { result = run(raw, { truncated }); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  if (result && result.exitCode === 2) process.exit(2);
  // additionalContext on the standalone path is surfaced via stdout JSON by the
  // harness only through run-with-flags; here we just pass through.
  process.stdout.write(raw);
  process.exit(0);
}
