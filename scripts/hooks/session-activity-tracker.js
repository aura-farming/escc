#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/session-activity-tracker.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*; converted to the ESCC hook contract
 * (synchronous run(raw, ctx)); ECC appended sanitized rows to a shared
 * tool-usage.jsonl, ESCC keeps a per-session activity file under the data root
 * and ADDS "accounts touched" (HubSpot deal/company/contact ids + email
 * domains) accumulation, finalizing on the SessionEnd marker.
 */
/**
 * post:session-activity-tracker AND session:end:marker
 *   matcher: * · profile: all
 *
 * Records per-session observability metrics for the harness:
 *   - tool call counts (total + per tool name),
 *   - files touched (deduped),
 *   - accounts touched: the set of HubSpot object ids and email domains the
 *     session referenced (ESCC addition for pipeline observability).
 *
 * Behavior is event-driven:
 *   - PostToolUse  → ACCUMULATE into <dataRoot>/metrics/activity/<session>.json
 *   - SessionEnd   → FINALIZE (stamp ended_at, mark finalized:true)
 *
 * Sync, fail-open, NEVER blocks. Any internal error returns {exitCode:0}.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  parseHookInput,
  getToolName,
  getToolInput,
  getSessionId,
  getEventName,
} = require('../lib/hook-input');
const { resolveAgentDataHome } = require('../lib/agent-data-home');
const { sanitizeSessionId } = require('../lib/session-bridge');

const ACTIVITY_SUBDIR = path.join('metrics', 'activity');

// tool_input fields that may carry file paths.
const FILE_PATH_KEYS = new Set([
  'file_path', 'file_paths', 'path', 'source_path',
  'destination_path', 'old_file_path', 'new_file_path',
]);

// tool_input fields that may carry a CRM object id.
const OBJECT_ID_KEYS = new Set([
  'objectId', 'object_id', 'id', 'dealId', 'deal_id',
  'companyId', 'company_id', 'contactId', 'contact_id',
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;

/** True for the session-finalize event (SessionEnd / a session:end marker). */
function isSessionEnd(eventName, hookId) {
  const e = String(eventName || '');
  const h = String(hookId || '');
  return /SessionEnd/i.test(e) || /session.?end/i.test(h);
}

/** Resolve the per-session activity file path under the data root. */
function activityFile(sessionId) {
  const dir = path.join(resolveAgentDataHome(), ACTIVITY_SUBDIR);
  return path.join(dir, `${sessionId}.json`);
}

/** Read the current activity record, or a fresh empty one. */
function readActivity(sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(activityFile(sessionId), 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_err) {
    // missing/torn → fresh record
  }
  return {
    session_id: sessionId,
    started_at: new Date().toISOString(),
    ended_at: null,
    finalized: false,
    tool_calls: 0,
    tools: {},
    files: [],
    accounts: [],
  };
}

/** Atomic-enough write: tmp + rename so a partial write never corrupts the file. */
function writeActivity(sessionId, record) {
  const target = activityFile(sessionId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), 'utf8');
  fs.renameSync(tmp, target);
}

/** Recursively gather file paths and CRM object ids from a tool input value. */
function collectFromValue(value, into, key) {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const entry of value) collectFromValue(entry, into, key);
    return;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (key && FILE_PATH_KEYS.has(key) && !/^(https?|app|plugin|mcp):\/\//i.test(trimmed)) {
      into.files.add(trimmed);
    }
    if (key && OBJECT_ID_KEYS.has(key)) {
      into.accounts.add(`id:${trimmed}`);
    }
    // email domains, wherever they appear
    let m;
    EMAIL_RE.lastIndex = 0;
    while ((m = EMAIL_RE.exec(trimmed)) !== null) {
      into.accounts.add(`domain:${m[1].toLowerCase()}`);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [k, nested] of Object.entries(value)) {
      collectFromValue(nested, into, k);
    }
  }
}

/**
 * Extract the files + accounts referenced by a tool input.
 * objectType + objectId together also yield a typed account key.
 * @param {object} toolInput
 * @returns {{files:string[], accounts:string[]}}
 */
function extractReferences(toolInput) {
  const into = { files: new Set(), accounts: new Set() };
  if (toolInput && typeof toolInput === 'object') {
    collectFromValue(toolInput, into, null);

    // objectType + objectId → typed account key (e.g. "deal:123").
    const objectType = toolInput.objectType || toolInput.object_type || toolInput.objectTypeId;
    const objectId = toolInput.objectId || toolInput.object_id || toolInput.id;
    if (objectType && objectId) {
      into.accounts.add(`${String(objectType).toLowerCase()}:${objectId}`);
    }
  }
  return { files: [...into.files], accounts: [...into.accounts] };
}

function mergeUnique(existing, additions) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(out);
  for (const a of additions) {
    if (!seen.has(a)) { out.push(a); seen.add(a); }
  }
  return out;
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean, hookId?: string}} [ctx]
 * @returns {{exitCode:number}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const eventName = getEventName(input) || process.env.CLAUDE_HOOK_EVENT_NAME || '';
    const sessionId =
      sanitizeSessionId(getSessionId(input)) ||
      sanitizeSessionId(process.env.ESCC_SESSION_ID) ||
      sanitizeSessionId(process.env.CLAUDE_SESSION_ID);

    if (!sessionId) return undefined; // nothing to key the record on

    // --- SessionEnd: finalize the record ---
    if (isSessionEnd(eventName, ctx.hookId)) {
      const record = readActivity(sessionId);
      record.ended_at = new Date().toISOString();
      record.finalized = true;
      writeActivity(sessionId, record);
      return undefined;
    }

    // --- PostToolUse: accumulate ---
    const toolName = getToolName(input);
    if (!toolName) return undefined;

    // A truncated payload still counts the tool call; we just skip ref-mining
    // the partial body to avoid recording garbage.
    const record = readActivity(sessionId);
    record.tool_calls += 1;
    record.tools[toolName] = (record.tools[toolName] || 0) + 1;

    if (!ctx.truncated) {
      const { files, accounts } = extractReferences(getToolInput(input));
      record.files = mergeUnique(record.files, files);
      record.accounts = mergeUnique(record.accounts, accounts);
    }

    writeActivity(sessionId, record);
    return undefined;
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — never block
  }
}

module.exports = {
  run,
  extractReferences,
  isSessionEnd,
  activityFile,
  readActivity,
  writeActivity,
};

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  try { run(raw, { truncated, hookId: process.env.ESCC_HOOK_ID }); } catch (_err) { /* fail open */ }
  process.stdout.write(raw);
  process.exit(0);
}
