#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/ecc-context-monitor.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_* and ecc->escc; converted to the ESCC hook contract
 * (synchronous run(raw, ctx) returning { additionalContext } for a non-blocking
 * message or undefined for pass-through — the ESCC dispatcher wraps
 * additionalContext into the harness payload, so this hook no longer hand-builds
 * the hookSpecificOutput JSON string ECC emitted).
 */
/**
 * post:context-monitor — PostToolUse hook (matcher *, profile all).
 *
 * Reads the session bridge (escc-metrics-${sessionId}.json, maintained by
 * post:metrics-bridge) and surfaces agent-facing warnings when a threshold is
 * crossed: context exhaustion, high cost, scope creep, or a tool loop. Cost
 * warnings are gated by ESCC_CONTEXT_MONITOR_COST_WARNINGS (default ON).
 *
 * Returns { additionalContext } when a NEW warning should be surfaced, otherwise
 * undefined. A per-session debounce file suppresses repeats of the same warning
 * text (so an unchanged cost figure does not print every tool call) while still
 * re-emitting on escalation to critical or when the warning text changes.
 *
 * Failure policy: fail OPEN, NEVER blocks. run() is synchronous; on any internal
 * error it returns undefined (no opinion, tool call proceeds, no warning).
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseHookInput, getSessionId } = require('../lib/hook-input');
const { sanitizeSessionId, readBridge, renameWithRetry } = require('../lib/session-bridge');

const CONTEXT_WARNING_PCT = 35;
const CONTEXT_CRITICAL_PCT = 25;
const COST_NOTICE_USD = 5;
const COST_WARNING_USD = 10;
const COST_CRITICAL_USD = 50;
const FILES_WARNING_COUNT = 20;
const LOOP_THRESHOLD = 3;
const STALE_SECONDS = 60;

const WARN_FILE_PREFIX = 'escc-ctx-warn-';

function isEnabledEnv(value, defaultValue = true) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  return defaultValue;
}

/** Whether cost warnings are enabled (ESCC_CONTEXT_MONITOR_COST_WARNINGS, default ON). */
function costWarningsEnabled(env = process.env) {
  return isEnabledEnv(env.ESCC_CONTEXT_MONITOR_COST_WARNINGS, true);
}

/** Per-session debounce state file path. */
function getWarnPath(sessionId) {
  return path.join(os.tmpdir(), `${WARN_FILE_PREFIX}${sessionId}.json`);
}

/** Read debounce state; defaults on any error. */
function readWarnState(sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(getWarnPath(sessionId), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to default
  }
  return { lastSeverity: null, lastMessage: null };
}

/**
 * Write debounce state atomically (unique-suffix tmp then rename). The tmp path
 * includes process.pid plus a random nonce so concurrent PostToolUse subprocesses
 * writing to the same session's warn-state file do not clobber each other's tmp
 * mid-write — same pattern as writeBridgeAtomic in scripts/lib/session-bridge.js.
 */
function writeWarnState(sessionId, state) {
  const target = getWarnPath(sessionId);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
  try {
    renameWithRetry(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Detect a tool loop from the recent_tools ring buffer: the same tool+hash
 * appearing LOOP_THRESHOLD or more times.
 * @param {Array} recentTools
 * @returns {{detected:boolean, tool:string, count:number}}
 */
function detectLoop(recentTools) {
  if (!Array.isArray(recentTools) || recentTools.length < LOOP_THRESHOLD) {
    return { detected: false, tool: '', count: 0 };
  }
  const counts = {};
  for (const entry of recentTools) {
    if (!entry) continue;
    const key = `${entry.tool}:${entry.hash}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(counts)) {
    if (count >= LOOP_THRESHOLD) {
      return { detected: true, tool: key.split(':')[0], count };
    }
  }
  return { detected: false, tool: '', count: 0 };
}

/**
 * Evaluate all warning conditions against the bridge data.
 * @param {object} bridge
 * @param {{costWarnings?:boolean}} [options]
 * @returns {Array<{severity:number, type:string, message:string}>} sorted severity desc
 */
function evaluateConditions(bridge, options = {}) {
  const warnings = [];
  const remaining = bridge.context_remaining_pct;

  // Context warnings (skip when no context data is available).
  if (remaining !== null && remaining !== undefined) {
    if (remaining <= CONTEXT_CRITICAL_PCT) {
      warnings.push({
        severity: 3,
        type: 'context',
        message:
          `CONTEXT CRITICAL: ${remaining}% remaining. Context nearly exhausted. ` +
          'Inform the user that context is low and ask how they want to proceed. ' +
          'Do NOT autonomously save state or write handoff files unless the user asks.',
      });
    } else if (remaining <= CONTEXT_WARNING_PCT) {
      warnings.push({
        severity: 2,
        type: 'context',
        message:
          `CONTEXT WARNING: ${remaining}% remaining. ` +
          'Be aware that context is getting limited. Avoid starting new complex work.',
      });
    }
  }

  // Cost warnings (gated).
  if (options.costWarnings !== false) {
    const cost = bridge.total_cost_usd || 0;
    if (cost > COST_CRITICAL_USD) {
      warnings.push({
        severity: 3,
        type: 'cost',
        message: `COST CRITICAL: session total ~$${cost.toFixed(2)} (over $${COST_CRITICAL_USD}). Informational only — not an instruction to stop.`,
      });
    } else if (cost > COST_WARNING_USD) {
      warnings.push({
        severity: 2,
        type: 'cost',
        message: `COST WARNING: session total ~$${cost.toFixed(2)} (over $${COST_WARNING_USD}). Informational only.`,
      });
    } else if (cost > COST_NOTICE_USD) {
      warnings.push({
        severity: 1,
        type: 'cost',
        message: `COST NOTICE: session total ~$${cost.toFixed(2)}. Informational only.`,
      });
    }
  }

  // File scope warning.
  const fileCount = bridge.files_modified_count || 0;
  if (fileCount > FILES_WARNING_COUNT) {
    warnings.push({
      severity: 2,
      type: 'scope',
      message:
        `SCOPE WARNING: ${fileCount} files modified this session. ` +
        'Consider whether changes are too scattered.',
    });
  }

  // Loop detection.
  const loop = detectLoop(bridge.recent_tools);
  if (loop.detected) {
    warnings.push({
      severity: 2,
      type: 'loop',
      message:
        `LOOP WARNING: Tool '${loop.tool}' called ${loop.count} times ` +
        'with the same parameters in the last 5 calls. This may indicate a stuck loop.',
    });
  }

  return warnings.sort((a, b) => b.severity - a.severity);
}

/** Map a numeric severity to a label. */
function severityLabel(n) {
  if (n >= 3) return 'critical';
  if (n >= 2) return 'warning';
  return 'notice';
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
 * @param {object} [_ctx] dispatcher context (unused; this hook never blocks)
 * @returns {{additionalContext:string}|undefined} additionalContext on a new
 *   warning, otherwise undefined (pass-through)
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);

    const sessionId = resolveSessionIdFrom(input);
    if (!sessionId) return undefined;

    const bridge = readBridge(sessionId);
    if (!bridge) return undefined; // no aggregate yet -> nothing to warn about

    // Stale check: if the bridge has not updated recently, the context figure is
    // unreliable, so suppress context warnings (cost/scope/loop still apply).
    const now = Math.floor(Date.now() / 1000);
    const lastTs = bridge.last_timestamp
      ? Math.floor(new Date(bridge.last_timestamp).getTime() / 1000)
      : 0;
    const isStale = lastTs > 0 && now - lastTs > STALE_SECONDS;
    const evalBridge = isStale ? { ...bridge, context_remaining_pct: null } : bridge;

    const warnings = evaluateConditions(evalBridge, { costWarnings: costWarningsEnabled() });

    if (warnings.length === 0) {
      // Clear dedupe state when conditions resolve, so the SAME warning recurring
      // later (context dips, recovers, dips again; a loop that stops then restarts)
      // is surfaced again. Only write when there is state to clear.
      const prior = readWarnState(sessionId);
      if (prior.lastMessage) {
        writeWarnState(sessionId, { lastSeverity: null, lastMessage: null });
      }
      return undefined;
    }

    // Combine the top two warnings.
    const message = warnings
      .slice(0, 2)
      .map(w => w.message)
      .join('\n');

    // Dedupe on message text. Re-emit only when the text changes (cost moved, new
    // file count, new loop) or when we newly escalate to critical.
    const warnState = readWarnState(sessionId);
    const topSeverity = severityLabel(warnings[0].severity);
    const escalatedToCritical = topSeverity === 'critical' && warnState.lastSeverity !== 'critical';
    const sameMessage = warnState.lastMessage === message;

    if (sameMessage && !escalatedToCritical) {
      return undefined;
    }

    writeWarnState(sessionId, { lastSeverity: topSeverity, lastMessage: message });

    return { additionalContext: message };
  } catch (_err) {
    // Fail open — never block, never warn on error.
    return undefined;
  }
}

module.exports = {
  run,
  evaluateConditions,
  detectLoop,
  severityLabel,
  costWarningsEnabled,
};

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  let result;
  try { result = run(raw, {}); } catch (_err) { result = undefined; }
  // PURE warn hook: never blocks. additionalContext is surfaced via the
  // run-with-flags JSON wrapper only; the standalone path passes stdin through.
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.stdout.write(raw);
  process.exit(0);
}
