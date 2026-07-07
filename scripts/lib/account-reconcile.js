/*
 * ESCC CRM-to-memory reconcile (NEW for ESCC; ADR-0018).
 *
 * "HubSpot wins" as CODE, not prose. account-memory folds deal fields
 * (stage/amount/close-date/status) from appended events — a DERIVED CACHE of
 * the CRM that drifts silently as the deal moves in HubSpot. This module
 * diffs a live CRM snapshot against the folded memory view and, on --apply,
 * appends `source: 'crm-reconcile'` events so the next hydrate matches CRM.
 *
 * Split responsibility (the CLI cannot call MCP): a SKILL/agent performs the
 * authoritative HubSpot read and hands the snapshot in as JSON
 * ({account, deals:[{deal_id, stage, amount, close_date, status, name}]});
 * this module is the deterministic Node fold-diff. All writes are LOCAL —
 * account-memory only. HubSpot is never written here (crm-operator remains
 * the sole CRM writer; this is the read-side sync).
 *
 * Loop policy: ONLY deal-status loops auto-close (a loop tied to a deal the
 * CRM now reports closed-won/lost). Every other open loop is a human
 * commitment — reconcile never touches it.
 */

'use strict';

const accountMemory = require('./account-memory');
const identity = require('./account-identity');

// The deal fields memory mirrors from CRM (the derived-cache surface).
const DEAL_FIELDS = ['stage', 'amount', 'close_date', 'status', 'name'];

function normalizeSnapshotDeal(deal) {
  if (!deal || typeof deal !== 'object') return null;
  const dealId = deal.deal_id ?? deal.dealId ?? deal.id;
  if (!dealId) return null;
  const out = { deal_id: String(dealId) };
  for (const f of DEAL_FIELDS) {
    const camel = f.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
    const v = deal[f] ?? deal[camel];
    if (v !== undefined && v !== null && v !== '') out[f] = v;
  }
  return out;
}

function isClosedStatus(status) {
  return accountMemory.CLOSED_STATUSES.has(String(status || '').toLowerCase());
}

/**
 * Diff a CRM snapshot against the account's folded memory and (optionally)
 * append reconcile events so memory matches CRM.
 * @param {string} accountId any identifier — resolves canonically (ADR-0018)
 * @param {{deals?: object[], asOf?: string}} snapshot agent-read CRM state
 * @param {{apply?: boolean, now?: string}} [options]
 * @returns {{account, canonical, asOf, drift, missingInMemory, unknownInCrm,
 *   loopsClosed, applied, eventsAppended}}
 */
function reconcile(accountId, snapshot = {}, options = {}) {
  const canonical = identity.accountKey(accountId);
  if (!canonical) throw new TypeError(`account-reconcile: unusable account id: ${accountId}`);
  const apply = options.apply === true;
  const now = options.now || new Date().toISOString();
  const asOf = snapshot.asOf || snapshot.as_of || now;

  const crmDeals = (Array.isArray(snapshot.deals) ? snapshot.deals : [])
    .map(normalizeSnapshotDeal)
    .filter(Boolean);
  const hydrated = accountMemory.hydrate(accountId);
  const memoryDeals = hydrated.deals || {};

  const drift = [];
  const missingInMemory = [];
  const toAppend = [];

  for (const crm of crmDeals) {
    const mem = memoryDeals[crm.deal_id];
    if (!mem) {
      missingInMemory.push(crm.deal_id);
      toAppend.push({ type: 'deal', ...crm });
      continue;
    }
    const changed = {};
    for (const f of DEAL_FIELDS) {
      if (crm[f] === undefined) continue; // snapshot may be partial per-field
      if (String(mem[f] ?? '') !== String(crm[f])) {
        drift.push({ deal_id: crm.deal_id, field: f, memory: mem[f] ?? null, crm: crm[f] });
        changed[f] = crm[f];
      }
    }
    if (Object.keys(changed).length) {
      toAppend.push({ type: 'deal', deal_id: crm.deal_id, ...changed });
    }
  }

  // Memory-only deals: REPORT, never auto-close — the snapshot may be partial
  // (a stage-filtered read), and closing a live deal from silence would make
  // the cache wronger than the drift it fixes.
  const crmIds = new Set(crmDeals.map(d => d.deal_id));
  const unknownInCrm = Object.keys(memoryDeals).filter(id => !crmIds.has(id));

  // Deal-status loops: a loop tied to a deal the CRM now reports CLOSED gets
  // auto-closed with provenance. Loops without a deal_id are human promises —
  // untouched.
  const loopsClosed = [];
  for (const loop of hydrated.openLoops || []) {
    if (!loop.deal_id || !loop.id) continue;
    const crm = crmDeals.find(d => d.deal_id === loop.deal_id);
    if (crm && isClosedStatus(crm.status)) {
      loopsClosed.push({ id: loop.id, deal_id: loop.deal_id, text: loop.text });
      // NO deal_id on the close marker: hydrate folds deal fields from ANY
      // event carrying one, and this event's status:'done' would overwrite
      // the deal's CRM status ('won'/'lost') — the id alone closes the loop.
      toAppend.push({
        id: loop.id,
        type: 'note',
        status: 'done',
        text: `auto-closed by crm-reconcile: deal ${loop.deal_id} is ${crm.status} in CRM`,
      });
    }
  }

  let eventsAppended = 0;
  if (apply) {
    for (const ev of toAppend) {
      accountMemory.appendEvent(canonical, {
        ...ev,
        source: 'crm-reconcile',
        ts: now,
        text: ev.text || `reconciled from CRM (as of ${asOf})`,
      });
      eventsAppended += 1;
    }
  }

  return {
    account: accountId,
    canonical,
    asOf,
    drift,
    missingInMemory,
    unknownInCrm,
    loopsClosed,
    applied: apply,
    eventsAppended,
  };
}

/** Human-readable drift report for the CLI. */
function formatReport(r) {
  const lines = [
    `${r.applied ? 'RECONCILED' : 'DRIFT REPORT (read-only — re-run with --apply to sync memory to CRM)'} — ${r.account} -> ${r.canonical} (CRM as of ${r.asOf})`,
  ];
  if (!r.drift.length && !r.missingInMemory.length && !r.unknownInCrm.length && !r.loopsClosed.length) {
    lines.push('  No drift: account-memory matches the CRM snapshot.');
    return lines.join('\n');
  }
  for (const d of r.drift) {
    lines.push(`  ${d.deal_id}.${d.field}: memory=${JSON.stringify(d.memory)} -> crm=${JSON.stringify(d.crm)}`);
  }
  for (const id of r.missingInMemory) lines.push(`  ${id}: in CRM but absent from memory (will seed)`);
  for (const id of r.unknownInCrm) {
    lines.push(`  ${id}: in memory but not in this CRM snapshot — REVIEW MANUALLY (never auto-closed; the snapshot may be partial)`);
  }
  for (const l of r.loopsClosed) lines.push(`  loop ${l.id} (${l.deal_id}): deal closed in CRM -> loop auto-closed${r.applied ? '' : ' on apply'}`);
  if (r.applied) lines.push(`  events appended: ${r.eventsAppended}`);
  return lines.join('\n');
}

module.exports = { DEAL_FIELDS, reconcile, formatReport, normalizeSnapshotDeal };
