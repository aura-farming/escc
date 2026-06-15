#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/suggest-compact.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_* (COMPACT_* -> ESCC_COMPACT_*); ported the counter
 * + nudge logic synchronously for the ESCC dispatcher's sync run() contract.
 */
/**
 * pre:edit-write:suggest-compact — nudge a strategic /compact at logical
 * intervals.
 *
 * Why manual over auto-compact (for a long sales session): auto-compact lands
 * at arbitrary points, often mid-task. Strategic compacting preserves context
 * through logical phases — compact after researching an account, before drafting
 * outreach; after a call-prep block, before logging to CRM.
 *
 * This is a PURE warn hook. It returns { additionalContext } to surface the
 * nudge to the model and NEVER blocks. It tracks a per-session tool-call counter
 * in a temp file and nudges once at the threshold (~50), then every 25 after.
 *
 * Failure policy: fails OPEN — any error returns undefined (no opinion, tool
 * call proceeds, no nudge).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getTempDir } = require('../lib/utils');
const { parseHookInput, getSessionId } = require('../lib/hook-input');

const COUNTER_FILE_PREFIX = 'escc-tool-count-';
const DEFAULT_THRESHOLD = 50;
const INTERVAL_AFTER_THRESHOLD = 25;
const DEFAULT_COMPACT_STATE_TTL_DAYS = 14;
const COUNTER_MAX = 1000000;

function getThreshold() {
  const parsed = parseInt(process.env.ESCC_COMPACT_THRESHOLD || String(DEFAULT_THRESHOLD), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10000 ? parsed : DEFAULT_THRESHOLD;
}

function getCounterRetentionDays() {
  const raw = process.env.ESCC_COMPACT_STATE_TTL_DAYS;
  if (!raw) return DEFAULT_COMPACT_STATE_TTL_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_COMPACT_STATE_TTL_DAYS;
}

/** Sanitize a session id to a safe filename segment (matches ECC's stripping). */
function safeSessionId(raw) {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
}

/**
 * Sweep stale per-session counter files so they do not accumulate one-per-session
 * forever. Removes counters strictly older than retentionDays; preserves the
 * active session's file. Never throws.
 */
function cleanupOldCounters(tempDir, retentionDays, currentCounterFile) {
  let entries;
  try {
    entries = fs.readdirSync(tempDir, { withFileTypes: true });
  } catch {
    return;
  }

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const currentBasename = path.basename(currentCounterFile);

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(COUNTER_FILE_PREFIX)) continue;
    if (entry.name === currentBasename) continue;

    const fullPath = path.join(tempDir, entry.name);
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      continue;
    }
    // Strictly older than retentionDays: preserve files exactly on the boundary.
    if (stats.mtimeMs >= cutoffMs) continue;

    try {
      fs.rmSync(fullPath, { force: true });
    } catch {
      // best-effort
    }
  }
}

/**
 * Read, increment, and persist the per-session counter. Uses an fd-based
 * read+truncate+write to narrow (not eliminate) the race window between
 * concurrent hook invocations. Returns the new count, or null on failure.
 */
function bumpCounter(counterFile) {
  try {
    const fd = fs.openSync(counterFile, 'a+');
    try {
      const buf = Buffer.alloc(64);
      const bytesRead = fs.readSync(fd, buf, 0, 64, 0);
      let count = 1;
      if (bytesRead > 0) {
        const parsed = parseInt(buf.toString('utf8', 0, bytesRead).trim(), 10);
        // Clamp corrupted/huge values back to a fresh start.
        count = (Number.isFinite(parsed) && parsed > 0 && parsed <= COUNTER_MAX) ? parsed + 1 : 1;
      }
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, String(count), 0);
      return count;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * @param {string|object} raw
 * @param {object} [_ctx]
 * @returns {{additionalContext:string}|undefined}
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const sessionId = safeSessionId(getSessionId(input) || process.env.ESCC_SESSION_ID || process.env.CLAUDE_SESSION_ID);
    const tempDir = getTempDir();
    const counterFile = path.join(tempDir, `${COUNTER_FILE_PREFIX}${sessionId}`);

    cleanupOldCounters(tempDir, getCounterRetentionDays(), counterFile);

    const count = bumpCounter(counterFile);
    if (count === null) return undefined; // counter unavailable -> no nudge

    const threshold = getThreshold();

    if (count === threshold) {
      return {
        additionalContext: `[strategic-compact] ${threshold} tool calls reached — consider /compact if you are transitioning between phases (e.g. finished account research, about to draft outreach).`,
      };
    }

    if (count > threshold && (count - threshold) % INTERVAL_AFTER_THRESHOLD === 0) {
      return {
        additionalContext: `[strategic-compact] ${count} tool calls — good checkpoint for /compact if the context is stale.`,
      };
    }

    return undefined;
  } catch (_err) {
    return undefined; // fail open: no nudge on any error
  }
}

module.exports = { run, getThreshold, safeSessionId, bumpCounter, cleanupOldCounters };

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  let result;
  try { result = run(raw, {}); } catch (_err) { result = undefined; }
  // PURE warn hook: never blocks. additionalContext is surfaced via run-with-flags
  // JSON only; the standalone path simply passes the payload through at exit 0.
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.stdout.write(raw);
  process.exit(0);
}
