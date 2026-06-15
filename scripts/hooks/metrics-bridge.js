#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/ecc-metrics-bridge.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_* and ecc->escc; converted to the ESCC hook contract
 * (synchronous run(raw, ctx) returning a pass-through verdict, with a standalone
 * fail-open fallback). Cost is sourced from the ESCC data root
 * (resolveAgentDataHome()/metrics/costs.jsonl) instead of ECC's getClaudeDir(),
 * and there is no separate per-session harness-cost cache file — the session
 * bridge (escc-metrics-${sessionId}.json) is the single statusline metrics source.
 */
/**
 * post:metrics-bridge — PostToolUse hook (matcher *, profile all).
 *
 * After each tool call, maintain a running per-session aggregate in the session
 * bridge file (os.tmpdir()/escc-metrics-${sessionId}.json, managed by
 * scripts/lib/session-bridge.js). The statusline reads this bridge to render
 * `$cost Nt Nf Nm | context %`, and post:context-monitor reads it to decide when
 * to surface utilization warnings — both avoid scanning the JSONL logs on every
 * invocation.
 *
 * Failure policy: fail OPEN. run() is synchronous; on any internal error it
 * returns { exitCode: 0 } so the tool call is never blocked.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { parseHookInput, getToolName, getToolInput, getSessionId } = require('../lib/hook-input');
const { sanitizeSessionId, readBridge, writeBridgeAtomic } = require('../lib/session-bridge');
const { resolveAgentDataHome } = require('../lib/agent-data-home');

const MAX_FILES_TRACKED = 200;
const RECENT_TOOLS_SIZE = 5;
const HASH_INPUT_LIMIT = 2048;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Deterministic stringify with a depth guard, so the same tool input always
 * hashes the same regardless of key order.
 */
function stableStringify(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item, depth + 1)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key], depth + 1)}`)
    .join(',')}}`;
}

/**
 * Hash a tool call for loop detection. Uses tool name + a key parameter when
 * available, otherwise a stable input digest. For Edit/Write/MultiEdit the full
 * change payload is hashed (not just the path) so distinct edits to one file do
 * not collide and look like a stuck loop.
 * @param {string} toolName
 * @param {object} toolInput
 * @returns {string} 8-char hex digest
 */
function hashToolCall(toolName, toolInput) {
  const name = String(toolName || '');
  let key = '';
  if (name === 'Bash') {
    key = String((toolInput && toolInput.command) || '').slice(0, 160);
  } else if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) {
    key = crypto
      .createHash('sha256')
      .update(
        stableStringify({
          file_path: toolInput && toolInput.file_path,
          old_string: toolInput && toolInput.old_string,
          new_string: toolInput && toolInput.new_string,
          content: toolInput && toolInput.content,
          edits: toolInput && toolInput.edits,
        })
      )
      .digest('hex');
  } else if (toolInput && toolInput.file_path) {
    key = String(toolInput.file_path);
  } else {
    key = stableStringify(toolInput || {}).slice(0, HASH_INPUT_LIMIT);
  }
  return crypto.createHash('sha256').update(`${name}:${key}`).digest('hex').slice(0, 8);
}

/**
 * Extract modified file paths from tool input (file_path plus any edits[].file_path).
 * @param {object} toolInput
 * @returns {string[]}
 */
function extractFilePaths(toolInput) {
  const paths = [];
  if (!toolInput || typeof toolInput !== 'object') return paths;

  const fp = toolInput.file_path;
  if (fp && typeof fp === 'string') paths.push(fp);

  const edits = toolInput.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (edit && typeof edit.file_path === 'string' && edit.file_path) {
        paths.push(edit.file_path);
      }
    }
  }

  return paths;
}

/**
 * Read the cumulative cost/tokens for a session from costs.jsonl.
 *
 * costs.jsonl (written by stop:cost-tracker under resolveAgentDataHome()/metrics)
 * is append-only; each row is the cumulative session total at the moment Stop
 * fired, so the value we want is the LAST row matching sessionId. Scans the full
 * file rather than a fixed trailing window so a session whose latest row was
 * pushed past that window by other sessions' rows is not silently reported as
 * zero. A missing file (no Stop yet this session) is the common case and yields
 * zeros without complaint.
 * @param {string} sessionId already-sanitized session id
 * @returns {{totalCost:number, totalIn:number, totalOut:number}}
 */
function readSessionCost(sessionId) {
  try {
    const costsPath = path.join(resolveAgentDataHome(), 'metrics', 'costs.jsonl');
    const content = fs.readFileSync(costsPath, 'utf8');

    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch (_err) {
        continue; // skip malformed rows; the bridge must not crash on one bad line
      }
      if (row && row.session_id === sessionId) {
        totalCost = toNumber(row.cost_usd);
        totalIn = toNumber(row.input_tokens);
        totalOut = toNumber(row.output_tokens);
      }
    }
    return { totalCost, totalIn, totalOut };
  } catch (_err) {
    // ENOENT (no costs file yet) and any other read error fail open to zeros.
    return { totalCost: 0, totalIn: 0, totalOut: 0 };
  }
}

/** Resolve the session id from the hook payload, then env fallbacks. */
function resolveSessionIdFrom(input) {
  return (
    sanitizeSessionId(getSessionId(input)) ||
    sanitizeSessionId(process.env.ESCC_SESSION_ID) ||
    sanitizeSessionId(process.env.CLAUDE_SESSION_ID)
  );
}

/**
 * @param {string|object} raw
 * @param {object} [_ctx] dispatcher context (unused; this hook always fails open)
 * @returns {{exitCode:number}} always exit 0 — this is a non-blocking PostToolUse hook
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const toolName = getToolName(input);
    const toolInput = getToolInput(input);

    const sessionId = resolveSessionIdFrom(input);
    if (!sessionId) return { exitCode: 0 }; // no session id -> nothing to aggregate

    const now = new Date().toISOString();
    const bridge = readBridge(sessionId) || {
      session_id: sessionId,
      total_cost_usd: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      tool_count: 0,
      files_modified_count: 0,
      files_modified: [],
      recent_tools: [],
      first_timestamp: now,
      last_timestamp: now,
      context_remaining_pct: null,
    };

    // Tool count + timestamps.
    bridge.tool_count = (bridge.tool_count || 0) + 1;
    bridge.last_timestamp = now;
    if (!bridge.first_timestamp) bridge.first_timestamp = now;

    // Track modified files (Write/Edit/MultiEdit only), capped at MAX_FILES_TRACKED.
    if (/^(Write|Edit|MultiEdit)$/i.test(toolName)) {
      const existing = new Set(bridge.files_modified || []);
      for (const p of extractFilePaths(toolInput)) {
        if (existing.size < MAX_FILES_TRACKED && !existing.has(p)) {
          existing.add(p);
        }
      }
      bridge.files_modified = [...existing];
      bridge.files_modified_count = existing.size;
    }

    // Ring buffer of recent tool calls for loop detection.
    const recent = Array.isArray(bridge.recent_tools) ? bridge.recent_tools : [];
    recent.push({ tool: toolName, hash: hashToolCall(toolName, toolInput) });
    while (recent.length > RECENT_TOOLS_SIZE) recent.shift();
    bridge.recent_tools = recent;

    // Refresh cost/tokens from costs.jsonl (cumulative per session).
    const costs = readSessionCost(sessionId);
    bridge.total_cost_usd = Math.round(costs.totalCost * 1e6) / 1e6;
    bridge.total_input_tokens = costs.totalIn;
    bridge.total_output_tokens = costs.totalOut;

    writeBridgeAtomic(sessionId, bridge);
  } catch (_err) {
    // Fail open — never block the tool call.
    return { exitCode: 0 };
  }

  return { exitCode: 0 };
}

module.exports = {
  run,
  hashToolCall,
  extractFilePaths,
  readSessionCost,
  stableStringify,
};

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  let result;
  try { result = run(raw, {}); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  // PostToolUse aggregator: never blocks. Pass the payload through unchanged.
  process.stdout.write(raw);
  process.exit(0);
}
