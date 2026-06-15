#!/usr/bin/env node
/*
 * stop:follow-through-check — adapted from ECC's Stop-hook follow-through pattern
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 *
 * WARN-ONLY (A.2 C3). At the end of a turn it surfaces:
 *   - ALL open promises in the state store (not just this session's), with
 *     overdue ones flagged — so a commitment made weeks ago still resurfaces;
 *   - this-session follow-through gaps: more follow-ups PROMISED than logged,
 *     and drafts created without a confirmed send/log.
 *
 * It never blocks (no exit 2); it only returns advisory additionalContext.
 * Fails OPEN on any error.
 */

'use strict';

const fs = require('fs');

const { parseHookInput, getSessionId } = require('../lib/hook-input');
const { sanitizeSessionId } = require('../lib/session-bridge');
const { createStateStoreSync } = require('../lib/state-store/index.js');
const { analyzeTranscript, resolveTranscriptPath } = require('./evaluate-session');

const MAX_LISTED = 6;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Gather open-promise warnings from the state store. */
function promiseWarnings(today) {
  let store;
  try {
    store = createStateStoreSync();
    const open = store.listOpenPromises();
    if (!open.length) return null;
    const overdue = open.filter(p => p.due_date && p.due_date < today);
    const lines = [`${open.length} open promise(s)${overdue.length ? ` — ${overdue.length} OVERDUE` : ''}:`];
    const ordered = [...overdue, ...open.filter(p => !overdue.includes(p))].slice(0, MAX_LISTED);
    for (const p of ordered) {
      const flag = p.due_date && p.due_date < today ? ' [OVERDUE]' : '';
      lines.push(`- ${p.text}${p.due_date ? ` (due ${p.due_date})` : ''}${p.account_id ? ` [${p.account_id}]` : ''}${flag}`);
    }
    return lines.join('\n');
  } catch (_err) {
    return null;
  } finally {
    if (store) store.close();
  }
}

/** Gather this-session follow-through gaps from the transcript metrics. */
function sessionGapWarnings(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
  const analysis = analyzeTranscript(transcriptPath);
  if (!analysis) return [];
  const m = analysis.metrics;
  const out = [];
  if (m.followUpsPromised > m.followUpsCreated) {
    out.push(
      `You promised ${m.followUpsPromised} follow-up(s) this session but only logged ${m.followUpsCreated} next-step(s) — log the rest in HubSpot before ending.`
    );
  }
  if (m.draftsCreated > 0) {
    out.push(`${m.draftsCreated} draft(s) created this session — confirm they are sent and the activity is logged (Gmail is draft-only).`);
  }
  return out;
}

/**
 * @param {string|object} raw
 * @param {object} [ctx]
 * @returns {{additionalContext:string}|{exitCode:number}|undefined}
 */
function run(raw, _ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const today = todayIso();
    const transcriptPath = resolveTranscriptPath(input);

    const parts = [];
    const promises = promiseWarnings(today);
    if (promises) parts.push(promises);
    parts.push(...sessionGapWarnings(transcriptPath));

    if (!parts.length) return undefined; // nothing to surface — stay silent
    return { additionalContext: `⚠️ follow-through-check:\n${parts.join('\n')}` };
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — Stop hooks never block
  }
}

module.exports = {
  run,
  promiseWarnings,
  sessionGapWarnings,
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
