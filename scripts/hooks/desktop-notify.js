#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/desktop-notify.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_* and ecc->escc; converted to the ESCC hook
 * contract (synchronous run(raw, ctx) returning a pass-through verdict, with a
 * standalone fail-open fallback) and routed delivery through ESCC's central
 * notification layer (scripts/lib/notify.js) so the desktop ping AND the JSONL
 * queue record are handled in one place, instead of raw osascript.
 */
/**
 * stop:desktop-notify (profiles: standard, strict)
 *
 * Fires a session-complete desktop notification when Claude finishes
 * responding. ECC owned osascript/iTerm2 OSC 9 delivery itself; ESCC instead
 * hands the title + summary to notify({ severity: 'high', ... }), which:
 *   - delivers a native macOS/Linux desktop notification (best-effort), and
 *   - appends one record to the central notifications JSONL queue.
 * notify.js is fully fail-soft (it never throws on a delivery failure), so this
 * hook stays fail-open. If notify.js is somehow unavailable, the hook degrades
 * to a no-op rather than blocking the Stop.
 *
 * Failure policy: fail OPEN. Any internal error returns { exitCode: 0 } and the
 * Stop is never blocked.
 */

'use strict';

const { parseHookInput } = require('../lib/hook-input');

const TITLE = 'ESCC — Claude Code';
const MAX_BODY_LENGTH = 100;
const DEFAULT_SUMMARY = 'Done';

// Session-complete is a benign, useful ping. notify.js routes "high" to a
// desktop notification on macOS plus one queued record for an MCP-capable step
// to optionally relay. It is intentionally NOT "critical" (no escalation) nor
// "medium"/"low" (those never surface on the desktop).
const SEVERITY = 'high';

/**
 * Extract a short summary from the last assistant message: first non-empty
 * line, truncated to MAX_BODY_LENGTH chars.
 * @param {*} message
 * @returns {string}
 */
function extractSummary(message) {
  if (!message || typeof message !== 'string') return DEFAULT_SUMMARY;

  const firstLine = message
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!firstLine) return DEFAULT_SUMMARY;

  return firstLine.length > MAX_BODY_LENGTH
    ? `${firstLine.slice(0, MAX_BODY_LENGTH)}...`
    : firstLine;
}

/**
 * @param {string|object} raw
 * @param {object} [ctx] dispatcher context (unused; this hook always fails open)
 * @returns {{exitCode:number}} always exit 0 — this is a non-blocking Stop hook
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const summary = extractSummary(input.last_assistant_message);

    // Route through ESCC's notification layer. Confirmed signature:
    //   notify({ severity, title, message, account?, channels? })
    //     -> { delivered: object[], queued: object[] }  (fail-soft, never throws)
    // Loaded lazily so a missing/broken notify module degrades to a no-op
    // rather than failing the require at module load.
    const { notify } = require('../lib/notify');
    notify({ severity: SEVERITY, title: TITLE, message: summary });
  } catch (_err) {
    // Fail open — never block the Stop hook.
    return { exitCode: 0 };
  }

  return { exitCode: 0 };
}

module.exports = {
  run,
  extractSummary,
};

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try { result = run(raw, { truncated }); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  // Stop hook: never echo a truncated payload (invalid JSON on stdout is read
  // as a hook failure). Otherwise pass stdin through unchanged.
  if (!truncated) process.stdout.write(raw);
  process.exit(0);
}
