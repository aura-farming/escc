#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/cost-tracker.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_* and ecc->escc; converted to the ESCC hook
 * contract (synchronous run(raw, ctx) returning a pass-through verdict, with a
 * standalone fail-open fallback) and re-pointed at the ESCC data root
 * (resolveAgentDataHome() default ~/.claude) instead of ECC's getClaudeDir().
 */
/**
 * stop:cost-tracker (profiles: minimal, standard, strict)
 *
 * On session Stop, append ONE row to <dataRoot>/metrics/costs.jsonl.
 *
 * The Stop payload carries { session_id, transcript_path, ... } but NOT usage
 * or model. ECC's fix was to read the transcript JSONL Claude Code already
 * passes us and sum usage across every assistant turn. Each row is the
 * cumulative session total at the moment Stop fired (Stop fires per assistant
 * response). For per-session cost take the last row per session_id.
 *
 * JSONL assistant entry shape (per Claude Code):
 *   { type: "assistant", message: { model, usage: { input_tokens,
 *     output_tokens, cache_creation_input_tokens, cache_read_input_tokens } } }
 *
 * Cost source: a transcript-sum estimate via the RATE_TABLE below. Per ESCC
 * Amendment A.4 there is NO fabricated harness-cost-<session_id>.json cache —
 * the session-bridge (escc-metrics-${sessionId}.json) is the single statusline
 * metrics source, and the authoritative per-row cost here is the transcript sum.
 *
 * Row field set (exact): ts, session_id, model, input_tokens, output_tokens,
 * cache_creation_input_tokens, cache_read_input_tokens, cost_usd.
 *
 * Failure policy: fail OPEN. Any internal error returns { exitCode: 0 } and the
 * Stop is never blocked.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseHookInput, getSessionId } = require('../lib/hook-input');
const { sanitizeSessionId } = require('../lib/session-bridge');
const { resolveAgentDataHome } = require('../lib/agent-data-home');

// Approximate per-1M-token billing rates (USD).
// Cache creation: 1.25x input rate. Cache read: 0.1x input rate.
const RATE_TABLE = {
  haiku: { in: 0.80, out: 4.0, cacheWrite: 1.00, cacheRead: 0.08 },
  sonnet: { in: 3.00, out: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  opus: { in: 15.00, out: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
};

function getRates(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) return RATE_TABLE.haiku;
  if (m.includes('opus')) return RATE_TABLE.opus;
  return RATE_TABLE.sonnet;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Scan the session JSONL and sum token usage across all assistant turns.
 * @param {string} transcriptPath
 * @returns {{inputTokens:number, outputTokens:number, cacheWriteTokens:number,
 *   cacheReadTokens:number, model:string}|null} null on read failure
 */
function sumUsageFromTranscript(transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_err) {
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let model = 'unknown';

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_err) { continue; }

    if (entry.type !== 'assistant') continue;
    const msg = entry.message;
    if (!msg || !msg.usage) continue;

    const u = msg.usage;
    inputTokens += toNumber(u.input_tokens);
    outputTokens += toNumber(u.output_tokens);
    cacheWriteTokens += toNumber(u.cache_creation_input_tokens);
    cacheReadTokens += toNumber(u.cache_read_input_tokens);

    if (msg.model && msg.model !== 'unknown') model = msg.model;
  }

  return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model };
}

/** Resolve the transcript path from the Stop payload or the env fallback. */
function resolveTranscriptPath(input) {
  if (input && typeof input.transcript_path === 'string' && input.transcript_path) {
    return input.transcript_path;
  }
  return process.env.CLAUDE_TRANSCRIPT_PATH || null;
}

/**
 * @param {string|object} raw
 * @param {object} [ctx] dispatcher context (unused; this hook always fails open)
 * @returns {{exitCode:number}} always exit 0 — this is a non-blocking Stop hook
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);

    const transcriptPath = resolveTranscriptPath(input);
    const sessionId =
      sanitizeSessionId(getSessionId(input)) ||
      sanitizeSessionId(process.env.ESCC_SESSION_ID) ||
      sanitizeSessionId(process.env.CLAUDE_SESSION_ID) ||
      'default';

    let usageTotals = null;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      usageTotals = sumUsageFromTranscript(transcriptPath);
    }

    const {
      inputTokens = 0,
      outputTokens = 0,
      cacheWriteTokens = 0,
      cacheReadTokens = 0,
      model = 'unknown',
    } = usageTotals || {};

    const rates = getRates(model);
    const costUsd = Math.round((
      (inputTokens / 1e6) * rates.in +
      (outputTokens / 1e6) * rates.out +
      (cacheWriteTokens / 1e6) * rates.cacheWrite +
      (cacheReadTokens / 1e6) * rates.cacheRead
    ) * 1e6) / 1e6;

    const metricsDir = path.join(resolveAgentDataHome(), 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });

    const row = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheWriteTokens,
      cache_read_input_tokens: cacheReadTokens,
      cost_usd: costUsd,
    };

    fs.appendFileSync(path.join(metricsDir, 'costs.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
  } catch (_err) {
    // Fail open — never block the Stop hook.
    return { exitCode: 0 };
  }

  return { exitCode: 0 };
}

module.exports = {
  run,
  sumUsageFromTranscript,
  getRates,
};

if (require.main === module) {
  const stdinFs = require('fs');
  let raw = '';
  try { raw = stdinFs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try { result = run(raw, { truncated }); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  // Stop hook: never echo a truncated payload (invalid JSON on stdout is read
  // as a hook failure). Otherwise pass stdin through unchanged.
  if (!truncated) process.stdout.write(raw);
  process.exit(0);
}
