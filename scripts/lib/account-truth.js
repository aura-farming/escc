/*
 * ESCC unified account-truth resolver (NEW for ESCC; ADR-0018).
 *
 * Answers "what is TRUE about this account right now" by joining every store
 * on the canonical identity key — with every section LABELED by source and
 * last-verified time, because a source-of-truth surface that presents stale
 * memory as live CRM fact is worse than no answer:
 *
 *   crm        live snapshot (agent-supplied, --input) — authoritative when present
 *   memory     account-memory folded deals + open loops (DERIVED CACHE of CRM)
 *   promises   the open-promise ledger (state store)
 *   outcomes   the outcomes ledger (what actually happened)
 *   governance outbound approvals/decisions stamped with this account (v1.8.0)
 *   voice      per-account style overlay + its last-updated stamp
 *
 * Product claims are deliberately NOT joined here — they are role/segment
 * keyed, not account keyed, and quoting them belongs to `escc product
 * retrieve` behind the ADR-0012 firewall.
 *
 * Cold-start honesty: with no live CRM snapshot supplied, CRM-derived fields
 * are memory values and the report says so loudly. Inference never renders as
 * confirmed fact.
 */

'use strict';

const identity = require('./account-identity');
const accountMemory = require('./account-memory');
const voiceOverlay = require('./voice-overlay');
const reconcileLib = require('./account-reconcile');

function countBy(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Join every store for one account.
 * @param {string} accountRaw any identifier — resolved canonically
 * @param {{crm?: object, now?: string, store?: object}} [options]
 *   crm: an agent-read live snapshot ({deals:[...], asOf}) — optional
 * @returns {object} the truth document (see formatTruth for the rendering)
 */
function resolveTruth(accountRaw, options = {}) {
  const resolved = identity.resolveAccountKey(accountRaw);
  if (!resolved.key) throw new TypeError(`account-truth: unusable account id: ${accountRaw}`);
  const canonical = resolved.key;
  const now = options.now || new Date().toISOString();

  const hydrated = accountMemory.hydrate(accountRaw);
  const staleDays = accountMemory.loopStaleDays();
  const nowMs = Date.parse(now);
  const loops = { live: [], stale: [] };
  for (const loop of hydrated.openLoops || []) {
    const t = loop.ts ? Date.parse(loop.ts) : NaN;
    const isStale = !Number.isNaN(t) && nowMs - t > staleDays * 24 * 60 * 60 * 1000;
    (isStale ? loops.stale : loops.live).push(loop);
  }

  let promises = [];
  let outcomes = [];
  let governance = [];
  try {
    const store = options.store || require('./state-store').createStateStoreSync();
    try {
      promises = store.listOpenPromises({ accountId: canonical });
      outcomes = store.listOutcomes({ accountId: canonical });
      governance = store.getGovernanceByAccount(canonical);
    } finally {
      if (!options.store) store.close();
    }
  } catch (_err) {
    /* state store unavailable — sections render as unavailable, not invented */
  }

  const crm = options.crm && typeof options.crm === 'object' ? options.crm : null;
  const drift = crm ? reconcileLib.reconcile(accountRaw, crm, { apply: false, now }) : null;

  return {
    account: accountRaw,
    canonical,
    identityTier: resolved.tier,
    identityVia: resolved.via,
    generatedAt: now,
    crm: crm
      ? { asOf: crm.asOf || crm.as_of || now, deals: (crm.deals || []).map(reconcileLib.normalizeSnapshotDeal).filter(Boolean) }
      : null,
    memory: {
      lastEventAt: hydrated.lastEventAt,
      eventCount: hydrated.eventCount,
      segment: hydrated.segment,
      deals: hydrated.deals,
      loops,
      staleDays,
    },
    promises,
    outcomeCounts: countBy(outcomes, r => r.type),
    lastOutcomeAt: outcomes.length ? outcomes[0].created_at : null,
    governanceCounts: countBy(governance, r => r.event_type),
    lastGovernanceAt: governance.length ? governance[0].created_at : null,
    voice: {
      lastUpdated: voiceOverlay.overlayLastUpdated(accountRaw),
    },
    drift,
  };
}

/** Render the truth document with per-section provenance labels. */
function formatTruth(t) {
  const lines = [];
  lines.push(`ACCOUNT TRUTH — ${t.account} -> ${t.canonical} (generated ${t.generatedAt})`);
  lines.push(`  identity: tier ${t.identityTier}${t.identityVia ? ` via alias ${t.identityVia}` : ''}${t.identityTier === 'name' ? ' — LOSSY: link it (escc identity link)' : ''}`);

  if (t.crm) {
    lines.push(`  [crm-live · as of ${t.crm.asOf}] deals: ${t.crm.deals.length}`);
    for (const d of t.crm.deals) {
      lines.push(`    ${d.deal_id}: ${d.stage || '?'}${d.amount != null ? ` · ${d.amount}` : ''}${d.close_date ? ` · close ${d.close_date}` : ''}${d.status ? ` · ${d.status}` : ''}`);
    }
  } else {
    lines.push('  [crm-live] NOT SUPPLIED — deal fields below are MEMORY values (a derived cache). Verify via a crm-operator read, or pass --input <crm.json>.');
  }

  const memDeals = Object.values(t.memory.deals || {});
  lines.push(`  [memory · derived cache · last event ${t.memory.lastEventAt || 'never'} · ${t.memory.eventCount} event(s)${t.memory.segment ? ` · segment ${t.memory.segment}` : ''}]`);
  for (const d of memDeals) {
    lines.push(`    ${d.deal_id}: ${d.stage || '?'}${d.amount != null ? ` · ${d.amount}` : ''}${d.close_date ? ` · close ${d.close_date}` : ''}${d.status ? ` · ${d.status}` : ''}`);
  }
  for (const loop of t.memory.loops.live) lines.push(`    open loop: ${loop.text || loop.type}${loop.due_date ? ` (due ${loop.due_date})` : ''}`);
  for (const loop of t.memory.loops.stale) lines.push(`    open loop (STALE >${t.memory.staleDays}d — reverify): ${loop.text || loop.type}`);

  lines.push(`  [promise ledger] ${t.promises.length} open promise(s)${t.promises.length ? ':' : ''}`);
  for (const p of t.promises.slice(0, 8)) lines.push(`    ${p.text}${p.due_date ? ` (due ${p.due_date})` : ''}`);

  const oc = Object.entries(t.outcomeCounts);
  lines.push(`  [outcome ledger${t.lastOutcomeAt ? ` · last ${String(t.lastOutcomeAt).slice(0, 10)}` : ''}] ${oc.length ? oc.map(([k, n]) => `${k}: ${n}`).join(', ') : 'none recorded yet'}`);

  const gc = Object.entries(t.governanceCounts);
  lines.push(`  [governance${t.lastGovernanceAt ? ` · last ${String(t.lastGovernanceAt).slice(0, 10)}` : ''}] ${gc.length ? gc.map(([k, n]) => `${k}: ${n}`).join(', ') : 'no outbound decisions stamped for this account (stamping began v1.8.0)'}`);

  lines.push(`  [voice overlay] ${t.voice.lastUpdated ? `last updated ${t.voice.lastUpdated}` : 'none built (escc voice account)'}`);

  if (t.drift) {
    const d = t.drift;
    if (d.drift.length || d.missingInMemory.length || d.loopsClosed.length) {
      lines.push(`  [drift vs crm-live] ${d.drift.length} field(s) drifted, ${d.missingInMemory.length} deal(s) missing in memory, ${d.loopsClosed.length} loop(s) closeable — run: escc reconcile ${t.account} --input <crm.json> --apply`);
    } else {
      lines.push('  [drift vs crm-live] none — memory matches the CRM snapshot.');
    }
  }

  lines.push('  note: product claims are NOT in this digest — retrieve approved claims via escc product retrieve (ADR-0012).');
  return lines.join('\n');
}

module.exports = { resolveTruth, formatTruth };
