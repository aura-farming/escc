#!/usr/bin/env node
/*
 * stop:sla-check — NEW for ESCC (A.6).
 *
 * WARN-ONLY. Surfaces breached response/deadline SLAs derived from open-loop
 * timestamps, complementing follow-through-check (which lists open work):
 *   - DEADLINE SLA: an open promise whose due_date has passed (days overdue);
 *   - RESPONSE SLA: an open loop / inbound reply on the active account that has
 *     been awaiting a response longer than ESCC_RESPONSE_SLA_HOURS (default 24).
 *
 * Never blocks (no exit 2) — advisory additionalContext only. Fails OPEN.
 */

'use strict';

const fs = require('fs');

const { parseHookInput } = require('../lib/hook-input');
const { createStateStoreSync } = require('../lib/state-store/index.js');
const accountMemory = require('../lib/account-memory');

const DEFAULT_RESPONSE_SLA_HOURS = 24;
const MAX_LISTED = 6;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

function getResponseSlaHours() {
  const n = Number.parseInt(String(process.env.ESCC_RESPONSE_SLA_HOURS || '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RESPONSE_SLA_HOURS;
}

/** Deadline-SLA breaches: open promises whose due_date has passed. */
function deadlineBreaches(nowMs) {
  let store;
  try {
    store = createStateStoreSync();
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const breached = store.listOpenPromises().filter(p => {
      if (!p.due_date) return false;
      const dueMs = Date.parse(p.due_date);
      return !Number.isNaN(dueMs) && p.due_date < today; // skip unparseable dates
    });
    return breached.map(p => {
      const days = Math.max(1, Math.floor((nowMs - Date.parse(p.due_date)) / MS_PER_DAY));
      return `- DEADLINE: "${p.text}"${p.account_id ? ` [${p.account_id}]` : ''} is ${days} day(s) overdue (due ${p.due_date}).`;
    });
  } catch (_err) {
    return [];
  } finally {
    if (store) store.close();
  }
}

/** Response-SLA breaches: active-account open loops older than the SLA window. */
function responseBreaches(nowMs) {
  let active;
  try {
    active = accountMemory.resolveActiveAccount();
  } catch (_err) {
    return [];
  }
  if (!active || !active.accountId) return [];
  const slaHours = getResponseSlaHours();
  const hydrated = accountMemory.hydrate(active.accountId);
  const out = [];
  for (const loop of hydrated.openLoops) {
    // Response SLA = an INBOUND reply/loop the rep owes a response to. A rep's
    // own outbound commitment (promise / next_step) or any deadline-tracked loop
    // is covered by the deadline SLA — exclude here to avoid double-counting and
    // false "awaiting a response" breaches on not-yet-due promises.
    if (loop.type === 'promise' || loop.type === 'next_step' || loop.due_date) continue;
    if (!loop.ts) continue;
    const ageHours = (nowMs - Date.parse(loop.ts)) / MS_PER_HOUR;
    if (Number.isFinite(ageHours) && ageHours > slaHours) {
      out.push(`- RESPONSE: "${loop.text || loop.type}" on ${hydrated.accountId} has been awaiting a response for ${Math.floor(ageHours)}h (SLA ${slaHours}h).`);
    }
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
    parseHookInput(raw); // tolerate/validate shape; payload fields unused beyond defaults
    const nowMs = Date.now();
    const breaches = [...deadlineBreaches(nowMs), ...responseBreaches(nowMs)].slice(0, MAX_LISTED);
    if (!breaches.length) return undefined; // no breach — stay silent
    return { additionalContext: `⚠️ sla-check — SLA breach(es) detected:\n${breaches.join('\n')}` };
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — Stop hooks never block
  }
}

module.exports = {
  run,
  deadlineBreaches,
  responseBreaches,
  getResponseSlaHours,
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
