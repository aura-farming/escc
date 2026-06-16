#!/usr/bin/env node
/*
 * session:end — adapted from ECC scripts/hooks/session-end.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 *
 * ECC extracted a transcript summary into a session-data markdown file for
 * cross-session continuity. ESCC keeps that, and ADDS the A.2 long-horizon
 * context fixes:
 *   C1 — appends tagged events to the ACTIVE account's memory (the canonical
 *        per-entity store), so a deal's context survives across months, not just
 *        the last session's summary.
 *   C3 — persists detected promises ("I'll send the proposal by …") to the
 *        state-store `promises` table as first-class records (idempotent upsert).
 *
 * Failure policy: fails OPEN. SessionEnd has no model turn to inject into, so
 * the hook does side-effects only and never blocks; any error returns exit 0.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseHookInput, getSessionId } = require('../lib/hook-input');
const {
  getDateString,
  getTimeString,
  getProjectName,
  sanitizeSessionId,
  getSessionIdShort,
  runCommand,
  stripAnsi,
} = require('../lib/utils');
const {
  getSessionDataDir,
  getSessionContent,
  writeSessionContent,
  writeSessionSummary,
  buildSummaryBlock,
} = require('../lib/session-manager');
const accountMemory = require('../lib/account-memory');
const promiseExtract = require('../lib/promise-extract');
const { createStateStoreSync } = require('../lib/state-store/index.js');
const distill = require('../instincts/distill');

const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const SESSION_SEPARATOR = '\n---\n';
const MAX_USER_MESSAGES = 10;

/** Resolve transcript path from the SessionEnd payload or the env fallback. */
function resolveTranscriptPath(input) {
  if (input && typeof input.transcript_path === 'string' && input.transcript_path) {
    return input.transcript_path;
  }
  return process.env.CLAUDE_TRANSCRIPT_PATH || null;
}

/** Read a (capped) transcript file; null on failure. */
function readTranscript(transcriptPath) {
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
        const bytes = fs.readSync(fd, buf, 0, MAX_TRANSCRIPT_BYTES, 0);
        return buf.toString('utf8', 0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    }
    return fs.readFileSync(transcriptPath, 'utf8');
  } catch (_err) {
    return null;
  }
}

/**
 * Parse a transcript JSONL into structured summary material plus the plain
 * conversation text used for promise extraction.
 * @returns {{userMessages, assistantTexts, toolsUsed, filesModified, plainText}|null}
 */
function analyzeTranscript(content) {
  if (!content) return null;
  const userMessages = [];
  const assistantTexts = [];
  const toolsUsed = new Set();
  const filesModified = new Set();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (_err) {
      continue;
    }

    const role = entry.type || entry.role || (entry.message && entry.message.role) || '';
    const rawContent = (entry.message && entry.message.content) ?? entry.content;

    if (role === 'user') {
      const text = typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map(c => (c && c.text) || '').join(' ')
          : '';
      const cleaned = stripAnsi(text).trim();
      if (cleaned) userMessages.push(cleaned.slice(0, 200));
    }

    if (role === 'assistant' && Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (block && block.type === 'text' && block.text) {
          assistantTexts.push(stripAnsi(String(block.text)).trim());
        }
        if (block && block.type === 'tool_use') {
          const toolName = block.name || '';
          if (toolName) toolsUsed.add(toolName);
          const filePath = block.input && block.input.file_path;
          if (filePath && (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit')) {
            filesModified.add(filePath);
          }
        }
      }
    }
  }

  if (userMessages.length === 0 && assistantTexts.length === 0) return null;

  return {
    userMessages: userMessages.slice(-MAX_USER_MESSAGES),
    assistantTexts,
    toolsUsed: [...toolsUsed].slice(0, 20),
    filesModified: [...filesModified].slice(0, 30),
    plainText: [...userMessages, ...assistantTexts].join('\n'),
  };
}

/** Read the per-session activity record (accounts touched) if present. */
function readActivityAccounts(sessionId) {
  if (!sessionId) return [];
  try {
    const { resolveAgentDataHome } = require('../lib/agent-data-home');
    const fp = path.join(resolveAgentDataHome(), 'metrics', 'activity', `${sessionId}.json`);
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch (_err) {
    return [];
  }
}

/**
 * Pick the primary account + deal from typed activity keys
 * (company:/domain:/id:/deal:). Account prefers company > domain > id > deal.
 * @param {string[]} accounts
 * @returns {{accountId: string|null, dealId: string|null}}
 */
function resolvePrimaryAccount(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  const dealKey = list.find(a => a.startsWith('deal:'));
  const dealId = dealKey ? dealKey.slice('deal:'.length) : null;
  const accountId =
    list.find(a => a.startsWith('company:')) ||
    list.find(a => a.startsWith('domain:')) ||
    list.find(a => a.startsWith('id:')) ||
    dealKey ||
    null;
  return { accountId, dealId };
}

function buildSummaryBody(summary, accounts, promises) {
  const lines = ['## Session Summary', '', '### Tasks'];
  for (const msg of summary.userMessages) {
    lines.push(`- ${msg.replace(/\n/g, ' ').replace(/`/g, '\\`')}`);
  }
  if (accounts.length) {
    lines.push('', '### Accounts touched');
    for (const a of accounts.slice(0, 15)) lines.push(`- ${a}`);
  }
  if (promises.length) {
    lines.push('', '### Promises captured');
    for (const p of promises) lines.push(`- ${p.text}${p.due_date ? ` (due ${p.due_date})` : ''}`);
  }
  if (summary.filesModified.length) {
    lines.push('', '### Files Modified');
    for (const f of summary.filesModified) lines.push(`- ${f}`);
  }
  if (summary.toolsUsed.length) {
    lines.push('', '### Tools Used', summary.toolsUsed.join(', '));
  }
  lines.push('', '### Stats', `- User messages: ${summary.userMessages.length}`, `- Promises captured: ${promises.length}`);
  return lines.join('\n');
}

function buildSessionHeader(today, currentTime) {
  const branch = runCommand('git rev-parse --abbrev-ref HEAD');
  return [
    `# Session: ${today}`,
    `**Date:** ${today}`,
    `**Started:** ${currentTime}`,
    `**Last Updated:** ${currentTime}`,
    `**Project:** ${getProjectName() || 'unknown'}`,
    `**Branch:** ${branch && branch.success ? branch.output : 'unknown'}`,
    `**Worktree:** ${process.cwd()}`,
    '',
  ].join('\n');
}

/** Write/update the session-data markdown summary (paired markers, header kept). */
function persistSummaryFile(sessionId, transcriptPath, body) {
  const today = getDateString();
  const currentTime = getTimeString();
  let shortId = null;
  if (transcriptPath) {
    const m = path.basename(transcriptPath).match(/([0-9a-f-]{8,})\.jsonl$/i);
    if (m) shortId = sanitizeSessionId(m[1].slice(-8).toLowerCase());
  }
  if (!shortId) shortId = sanitizeSessionId(sessionId) || getSessionIdShort();

  const sessionDir = getSessionDataDir();
  fs.mkdirSync(sessionDir, { recursive: true }); // writeSessionContent does not mkdir
  const sessionFile = path.join(sessionDir, `${today}-${shortId}-session.tmp`);
  const existing = getSessionContent(sessionFile);
  if (existing && existing.trim()) {
    writeSessionSummary(sessionFile, body);
  } else {
    writeSessionContent(sessionFile, `${buildSessionHeader(today, currentTime)}${SESSION_SEPARATOR}${buildSummaryBlock(body)}\n`);
  }
  return sessionFile;
}

/**
 * Runtime DERIVE step (A.3): turn this rep's accumulated observations into
 * instincts once per session. distill is idempotent (it recomputes from the full
 * observation log, preserving timestamps and honouring the reject registry), so
 * running it every SessionEnd is safe. Fully self-contained and fail-open — it
 * must never block a session from ending — and intentionally decoupled from the
 * transcript-summary path below so it still runs when there is nothing to
 * summarise (e.g. a short session, or unparseable input).
 */
function distillInstincts() {
  let store;
  try {
    store = createStateStoreSync();
    distill.distill({ store, now: new Date().toISOString() });
  } catch (_err) {
    /* fail open — distillation must never block a session from ending */
  } finally {
    try { if (store) store.close(); } catch (_e) { /* ignore */ }
  }
}

/**
 * @param {string|object} raw
 * @param {object} [ctx] dispatcher context (unused; always fails open)
 * @returns {{exitCode:number}|undefined}
 */
function run(raw, _ctx = {}) {
  try {
    distillInstincts(); // A.3 derive — before anything that can early-return
    const input = parseHookInput(raw);
    const sessionId =
      sanitizeSessionId(getSessionId(input)) ||
      sanitizeSessionId(process.env.ESCC_SESSION_ID) ||
      sanitizeSessionId(process.env.CLAUDE_SESSION_ID) ||
      'default';

    const transcriptPath = resolveTranscriptPath(input);
    const content = transcriptPath ? readTranscript(transcriptPath) : null;
    const summary = analyzeTranscript(content);
    if (!summary) return undefined; // nothing substantive to persist

    const accounts = readActivityAccounts(sessionId);
    const { accountId, dealId } = resolvePrimaryAccount(accounts);

    // C3 — extract promises and persist as first-class state-store records.
    const promises = promiseExtract.extractPromises(summary.plainText, {
      accountId,
      dealId,
      sessionId,
    });

    if (promises.length) {
      let store;
      try {
        store = createStateStoreSync();
        for (const p of promises) {
          try {
            store.upsertPromise(p); // idempotent: id is a stable hash of account+text
          } catch (_err) {
            // Isolate one invalid record so it can't abort the rest of the batch
            // or the C1 account-memory append + summary write that follow.
          }
        }
      } finally {
        if (store) store.close();
      }
    }

    // C1 — append tagged events to the active account's memory.
    if (accountId) {
      try {
        accountMemory.appendEvent(accountId, {
          type: 'session_summary',
          text: (summary.userMessages[0] || 'session').slice(0, 200),
          deal_id: dealId,
          session_id: sessionId,
          source: 'session:end',
        });
        for (const p of promises) {
          accountMemory.appendEvent(accountId, {
            id: p.id,
            type: 'promise',
            text: p.text,
            deal_id: p.deal_id,
            due_date: p.due_date,
            status: 'open',
            session_id: sessionId,
            source: 'session:end',
          });
        }
      } catch (_err) {
        /* account memory is best-effort; the state store already has the promises */
      }
    }

    // Session summary file (cross-session continuity; secondary index per C1).
    persistSummaryFile(sessionId, transcriptPath, buildSummaryBody(summary, accounts, promises));
    return undefined;
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — never block a session from ending
  }
}

module.exports = {
  run,
  distillInstincts,
  analyzeTranscript,
  readTranscript,
  resolveTranscriptPath,
  resolvePrimaryAccount,
  readActivityAccounts,
  buildSummaryBody,
};

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  try { run(raw, {}); } catch (_err) { /* fail open */ }
  process.stdout.write(raw);
  process.exit(0);
}
