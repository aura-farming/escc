#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/evaluate-session.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*; converted to the ESCC hook contract
 * (synchronous run(raw, ctx)). ECC counted user messages in the transcript and,
 * past a threshold, signaled "evaluate for extractable patterns" (to feed its
 * continuous-learning skill). ESCC preserves that learning signal but DECOUPLES
 * it from any instinct engine — it simply records a session_outcome observation
 * row under the data root. ESCC ADDS lightweight SALES metrics derived from the
 * transcript (drafts created, calendar events, transcripts fetched, follow-ups
 * promised vs created) as part of the same learning/summary signal.
 */
/**
 * stop:evaluate-session
 *   matcher: * · profile: all
 *
 * Runs once at session end. From the Stop payload it resolves the transcript,
 * counts user messages, and — when the session has enough substance
 * (>= ESCC_MIN_SESSION_LENGTH user messages, default 10) — records a
 * session_outcome observation (JSONL) under the data root and returns a short
 * non-blocking summary the model sees. Below the threshold it stays silent.
 *
 * Sync, fail-open, NEVER blocks. Any internal error returns {exitCode:0}.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseHookInput, getSessionId } = require('../lib/hook-input');
const { resolveAgentDataHome } = require('../lib/agent-data-home');
const { sanitizeSessionId } = require('../lib/session-bridge');

// Where session-outcome observations land. Kept under the data root and fully
// self-contained; no coupling to an instinct/learning engine that may not exist.
const OBSERVATIONS_SUBDIR = path.join('escc', 'observations');
const OBSERVATIONS_FILE = 'session-outcomes.jsonl';

const DEFAULT_MIN_SESSION_LENGTH = 10;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024; // cap the read so a huge transcript never stalls the Stop hook

// --- sales-signal patterns (derived from the transcript text) ---
// Each maps to a metric we can count from tool-call / assistant text in the
// session. These are best-effort learning signals, not authoritative counts.
const SALES_SIGNALS = {
  // A Gmail draft was created (draft-only by construction in ESCC).
  draftsCreated: /create_draft|gmail[^\n]*draft|drafted (?:an?|the) email/gi,
  // A calendar event was created (a meeting booked / scheduled).
  meetingsBooked: /create_event|calendar[^\n]*create|meeting (?:booked|scheduled|set)/gi,
  // A call/meeting transcript was fetched for review.
  transcriptsFetched: /Fireflies|fetch[^\n]*transcript|call transcript/gi,
  // Follow-ups the rep promised to do (commitments made to a prospect).
  followUpsPromised: /\bI'?ll (?:follow up|send|circle back|get back)|will follow up|promised to/gi,
  // Follow-ups actually actioned (a task/next-step logged).
  followUpsCreated: /next step|follow-?up (?:task|logged|created)|hs_next_step/gi,
};

/** Resolve the min user-message threshold (ESCC_MIN_SESSION_LENGTH, default 10). */
function getMinSessionLength() {
  const raw = String(process.env.ESCC_MIN_SESSION_LENGTH || '').trim();
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MIN_SESSION_LENGTH;
}

/** Resolve the transcript path from the Stop payload or the env fallback. */
function resolveTranscriptPath(input) {
  if (input && typeof input.transcript_path === 'string' && input.transcript_path) {
    return input.transcript_path;
  }
  return process.env.CLAUDE_TRANSCRIPT_PATH || null;
}

/**
 * Read the transcript and derive a learning signal: user-message count plus the
 * lightweight sales metrics above. Counts user turns from the JSONL `type`
 * field (with a regex fallback for the legacy text shape ECC used), and counts
 * sales signals against the whole transcript text.
 * @param {string} transcriptPath
 * @returns {{messageCount:number, metrics:object}|null} null on read failure
 */
function analyzeTranscript(transcriptPath) {
  let content;
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      // Read only the leading window; message-count + signals stay representative.
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
        const bytes = fs.readSync(fd, buf, 0, MAX_TRANSCRIPT_BYTES, 0);
        content = buf.toString('utf8', 0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      content = fs.readFileSync(transcriptPath, 'utf8');
    }
  } catch (_err) {
    return null;
  }

  // Count user messages. Prefer JSON line parsing; fall back to a regex count
  // (matches ECC's `"type":"user"` heuristic) if the lines are not clean JSON.
  let messageCount = 0;
  let parsedAny = false;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_err) { continue; }
    parsedAny = true;
    if (entry && entry.type === 'user') messageCount += 1;
  }
  if (!parsedAny) {
    const m = content.match(/"type"\s*:\s*"user"/g);
    messageCount = m ? m.length : 0;
  }

  const metrics = {};
  for (const [key, pattern] of Object.entries(SALES_SIGNALS)) {
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    metrics[key] = matches ? matches.length : 0;
  }

  return { messageCount, metrics };
}

/** Append a session-outcome observation row (sync; creates the dir). */
function recordObservation(observation) {
  const dir = path.join(resolveAgentDataHome(), OBSERVATIONS_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, OBSERVATIONS_FILE), `${JSON.stringify(observation)}\n`);
}

/** Build a one-line human summary of the sales metrics that are non-zero. */
function summarizeMetrics(metrics) {
  const labels = {
    draftsCreated: 'draft(s)',
    meetingsBooked: 'meeting(s) booked',
    transcriptsFetched: 'transcript(s) fetched',
    followUpsPromised: 'follow-up(s) promised',
    followUpsCreated: 'follow-up(s) logged',
  };
  const parts = [];
  for (const [key, label] of Object.entries(labels)) {
    if (metrics[key] > 0) parts.push(`${metrics[key]} ${label}`);
  }
  return parts.join(', ');
}

/**
 * @param {string|object} raw
 * @param {object} [ctx] dispatcher context (unused; always fails open)
 * @returns {{exitCode:number}|{additionalContext:string}|undefined}
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

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return undefined; // nothing to evaluate
    }

    const analysis = analyzeTranscript(transcriptPath);
    if (!analysis) return undefined;

    const minSessionLength = getMinSessionLength();
    if (analysis.messageCount < minSessionLength) {
      return undefined; // too short to yield extractable patterns
    }

    // Record the learning signal as a self-contained observation row.
    recordObservation({
      session_id: sessionId,
      message_count: analysis.messageCount,
      metrics: analysis.metrics,
      evaluate_for_patterns: true,
      created_at: new Date().toISOString(),
    });

    const salesSummary = summarizeMetrics(analysis.metrics);
    const base =
      `evaluate-session: ${analysis.messageCount} user messages — substantial session, ` +
      'worth reviewing for reusable patterns.';
    return {
      additionalContext: salesSummary ? `${base} Sales activity this session: ${salesSummary}.` : base,
    };
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — never block a Stop hook
  }
}

module.exports = {
  run,
  analyzeTranscript,
  resolveTranscriptPath,
  getMinSessionLength,
  summarizeMetrics,
  recordObservation,
  SALES_SIGNALS,
};

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  let result;
  try { result = run(raw, {}); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.additionalContext) process.stderr.write(`${result.additionalContext}\n`);
  process.stdout.write(raw);
  process.exit(0);
}
