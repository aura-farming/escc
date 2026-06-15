#!/usr/bin/env node
/*
 * pre:compact — adapted from ECC scripts/hooks/pre-compact.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 *
 * ECC logged that a compaction happened. ESCC implements A.2 C4: before context
 * is summarized away, persist a RESUMABLE scratch file capturing the live task —
 * task intent, active account/deal, pending actions, findings, and pending tool
 * actions — so the post-compaction SessionStart (mode "compact") can resume from
 * it instead of losing the working state. Round-trip is covered by tests.
 *
 * Failure policy: fails OPEN. PreCompact must never block; any error returns
 * exit 0 and compaction proceeds.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseHookInput, getSessionId } = require('../lib/hook-input');
const { sanitizeSessionId } = require('../lib/session-bridge');
const { resolveAgentDataHome } = require('../lib/agent-data-home');
const { atomicWriteJson, readJson } = require('../lib/utils');
const { analyzeTranscript, readTranscript, resolveTranscriptPath } = require('./session-end');
const accountMemory = require('../lib/account-memory');

const COMPACTION_SUBDIR = path.join('escc', 'compaction');
const MAX_PENDING = 8;
const MAX_TOOL_ACTIONS = 6;

// Assistant lines that signal an unfinished action worth resuming.
const PENDING_RE = /\b(next step|to-?do|still need|remaining|pending|follow up|i['’]?ll|we['’]?ll|need to|waiting on|blocked on)\b/i;
// Assistant lines that signal a finding/observation worth preserving.
const FINDING_RE = /\b(found|discovered|note:|risk:|blocker:|gap:|identified|turns out)\b/i;

/** Absolute path to a session's compaction scratch file. */
function compactionFile(sessionId, options = {}) {
  const safe = sanitizeSessionId(sessionId) || 'default';
  return path.join(resolveAgentDataHome(options), COMPACTION_SUBDIR, `${safe}.json`);
}

/** Read a session's compaction scratch state, or null if absent/unreadable. */
function readCompactionState(sessionId, options = {}) {
  return readJson(compactionFile(sessionId, options), null);
}

/**
 * Delete a session's compaction scratch (one-shot consume by session:start so a
 * resumed task never re-injects on a later SessionStart). Fail-open.
 */
function clearCompactionState(sessionId, options = {}) {
  try {
    fs.rmSync(compactionFile(sessionId, options), { force: true });
  } catch (_err) {
    /* best-effort; absence is the desired end state */
  }
}

/** Pull resume-worthy lines from assistant text against a matcher. */
function collectLines(assistantTexts, matcher, limit) {
  const out = [];
  for (const block of assistantTexts) {
    for (const rawLine of String(block).split('\n')) {
      const line = rawLine.trim();
      if (line && matcher.test(line)) {
        out.push(line.slice(0, 200));
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/**
 * @param {string|object} raw
 * @param {object} [ctx] dispatcher context (unused; always fails open)
 * @returns {{exitCode:number}|undefined}
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const sessionId =
      sanitizeSessionId(getSessionId(input)) ||
      sanitizeSessionId(process.env.ESCC_SESSION_ID) ||
      sanitizeSessionId(process.env.CLAUDE_SESSION_ID) ||
      'default';

    const transcriptPath = resolveTranscriptPath(input);
    const content = transcriptPath ? readTranscript(transcriptPath) : null;
    const analysis = content ? analyzeTranscript(content) : null;

    const active = accountMemory.resolveActiveAccount() || {};

    const state = {
      session_id: sessionId,
      created_at: new Date().toISOString(),
      trigger: typeof input.trigger === 'string' ? input.trigger : '',
      task_intent: analysis && analysis.userMessages.length
        ? analysis.userMessages[analysis.userMessages.length - 1].slice(0, 300)
        : '',
      active_account: active.accountId || null,
      active_deal: active.dealId || null,
      pending_actions: analysis ? collectLines(analysis.assistantTexts, PENDING_RE, MAX_PENDING) : [],
      findings: analysis ? collectLines(analysis.assistantTexts, FINDING_RE, MAX_PENDING) : [],
      pending_tool_actions: analysis ? analysis.toolsUsed.slice(0, MAX_TOOL_ACTIONS) : [],
    };

    atomicWriteJson(compactionFile(sessionId), state);
    return undefined;
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — never block compaction
  }
}

module.exports = {
  run,
  compactionFile,
  readCompactionState,
  clearCompactionState,
  collectLines,
  PENDING_RE,
  FINDING_RE,
};

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  try { run(raw, {}); } catch (_err) { /* fail open */ }
  process.stdout.write(raw);
  process.exit(0);
}
