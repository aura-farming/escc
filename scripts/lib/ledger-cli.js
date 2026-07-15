'use strict';

/*
 * ESCC ledger verbs — `escc outcome`, `escc truth`, `escc audit` (the v1.8.0
 * learning loop + ADR-0018 account truth + governance audit). Extracted from
 * the escc.js dispatcher so the router stays a thin, under-cap module; every
 * runner keeps the uniform { code, text, data } contract.
 */

const fs = require('fs');

const accountIdentity = require('./account-identity');
const accountTruth = require('./account-truth');

// Known outcome types (same guard as AUDIT_EVENT_TYPES below: a typo'd --type
// would otherwise record a row no distiller ever reads, or filter a list down
// to a convincing-but-false empty).
const OUTCOME_TYPES = new Set([
  'reply_received', 'meeting_booked', 'deal_stage_advanced', 'sequence_step_engaged', 'closed_won', 'closed_lost',
]);

/**
 * Outcome-ledger verbs (v1.8.0 learning loop): attest, inspect, and summarize
 * the outcomes that move instinct confidence at SessionEnd (I2). `record` is
 * the rep-attestation path for outcomes with no tool call to hook (a prospect
 * REPLY); stage advances and booked meetings capture automatically via
 * post:outcome-capture.
 */
function runOutcome(positional, flags) {
  const action = positional[0] || 'list';
  const { createStateStoreSync } = require('./state-store');
  try {
    if (flags.type && !OUTCOME_TYPES.has(flags.type)) {
      return { code: 1, text: `outcome ${action}: unknown --type "${flags.type}". Known: ${[...OUTCOME_TYPES].join(', ')}`, data: null };
    }
    if (action === 'record') {
      if (!flags.type) {
        return { code: 1, text: 'outcome record requires --type <reply_received|meeting_booked|deal_stage_advanced|sequence_step_engaged|closed_won|closed_lost>.', data: null };
      }
      const accountId = flags.account ? accountIdentity.accountKey(String(flags.account)) : null;
      // Dedupe key (v1.9.0 auto-attest): when --thread is supplied, the same
      // inbound reply attested twice (double-triage of one thread) collapses to
      // one row. Thread id is the rep's own mailbox metadata, never prospect
      // prose. Without --thread, behavior is unchanged (always insert).
      const thread = flags.thread ? String(flags.thread) : null;
      const fingerprint = thread
        ? require('crypto').createHash('sha1').update(`${flags.type}:${accountId || ''}:${thread}`).digest('hex')
        : null;
      const store = createStateStoreSync();
      try {
        if (fingerprint) {
          const existing = store.listOutcomes({ type: flags.type, accountId }).find(r => r.fingerprint === fingerprint);
          if (existing) {
            return { code: 0, text: `Already attested ${flags.type}${accountId ? ` for ${accountId}` : ''} (thread ${thread}) — no duplicate row.`, data: existing };
          }
        }
        const payload = {};
        if (flags.note) payload.note = String(flags.note).slice(0, 200);
        if (thread) payload.thread_id = thread;
        const row = store.insertOutcome({
          id: `oc-${Date.now().toString(36)}-${require('crypto').randomBytes(4).toString('hex')}`,
          type: flags.type,
          fingerprint,
          account_id: accountId,
          deal_id: flags.deal ? String(flags.deal) : null,
          session_id: process.env.CLAUDE_SESSION_ID || null,
          payload: Object.keys(payload).length ? payload : null,
        });
        return { code: 0, text: `Recorded outcome ${row.type}${accountId ? ` for ${accountId}` : ''} — the ledger moves instinct confidence at session end.`, data: row };
      } finally {
        store.close();
      }
    }
    if (action === 'void') {
      const id = positional[1] || flags.id;
      if (!id) return { code: 1, text: 'outcome void requires an outcome id (rolls the row back so it stops moving instinct confidence and truth counts).', data: null };
      const store = createStateStoreSync();
      try {
        const row = store.listOutcomes({ includeVoided: true }).find(r => r.id === id);
        if (!row) return { code: 1, text: `No outcome with id ${id}.`, data: null };
        if (row.payload && row.payload.voided) return { code: 0, text: `Outcome ${id} is already voided.`, data: row };
        const voided = store.insertOutcome({ ...row, payload: { ...(row.payload || {}), voided: true } });
        return { code: 0, text: `Voided outcome ${id} (${row.type}) — excluded from the ledger everywhere (distill, truth, summary).`, data: voided };
      } finally {
        store.close();
      }
    }
    if (action === 'list') {
      const store = createStateStoreSync();
      try {
        const accountId = flags.account ? accountIdentity.accountKey(String(flags.account)) : null;
        const rows = store.listOutcomes({ type: flags.type || null, accountId });
        const limit = flags.limit ? Number(flags.limit) : 20;
        const shown = rows.slice(0, Number.isFinite(limit) ? limit : 20);
        const data = { outcomes: shown, total: rows.length };
        if (flags.json) return { code: 0, text: JSON.stringify(data, null, 2), data };
        const text = shown.length
          ? `Outcomes (${shown.length}/${rows.length}):\n${shown.map(r => `  ${String(r.created_at).slice(0, 10)} ${r.type}${r.account_id ? ` [${r.account_id}]` : ''}${r.deal_id ? ` deal ${r.deal_id}` : ''}`).join('\n')}`
          : 'No outcomes recorded yet — the ledger fills from deal-stage writes, booked meetings, and `escc outcome record`.';
        return { code: 0, text, data };
      } finally {
        store.close();
      }
    }
    if (action === 'summary') {
      const sessionSignal = require('./session-signal');
      const store = createStateStoreSync();
      let counts = {};
      try {
        for (const r of store.listOutcomes()) counts[r.type] = (counts[r.type] || 0) + 1;
      } finally {
        store.close();
      }
      const countLines = Object.keys(counts).length
        ? Object.entries(counts).map(([t, n]) => `  ${t}: ${n}`).join('\n')
        : '  (empty — the loop starts compounding once outcomes land)';
      const follow = sessionSignal.formatFollowThrough(sessionSignal.followThroughSummary());
      const text = `Outcome ledger:\n${countLines}${follow ? `\n${follow}` : ''}`;
      return { code: 0, text, data: { counts } };
    }
    return { code: 1, text: `outcome: unknown action '${action}' (record | void | list | summary)`, data: null };
  } catch (err) {
    return { code: 1, text: `outcome ${action} failed: ${err.message}`, data: null };
  }
}

/** Account truth (ADR-0018): the reconciled, provenance-labeled picture. */
function runTruth(positional, flags) {
  const account = positional[0];
  if (!account) return { code: 1, text: 'truth requires <account> (name, domain, email, or company:<id>).', data: null };
  let crm = null;
  if (flags.input) {
    try {
      crm = JSON.parse(fs.readFileSync(flags.input, 'utf8'));
    } catch (err) {
      return { code: 1, text: `truth: could not read the CRM snapshot (--input): ${err.message}`, data: null };
    }
  }
  try {
    const t = accountTruth.resolveTruth(account, { crm });
    return { code: 0, text: accountTruth.formatTruth(t), data: t };
  } catch (err) {
    return { code: 1, text: `truth failed: ${err.message}`, data: null };
  }
}

// Known governance event types (a typo'd --event-type filter would otherwise
// silently return an empty result and read as a compliance pass).
const AUDIT_EVENT_TYPES = new Set([
  'outbound_approval', 'outbound_review', 'outbound_send', 'unapproved_send', 'bulk_send_attempt',
  'secret_detected', 'policy_violation', 'approval_requested', 'hook_input_truncated', 'crm_destructive_op',
]);

/**
 * Governance audit (v1.8.0): query/export the outbound decision ledger —
 * "prove we honored this opt-out", "list every override this quarter".
 * Read-only, local-only.
 */
function runAudit(positional, flags) {
  try {
    const outboundReview = require('./outbound-review');
    const { resolveStateStorePath } = require('./state-store');
    let rows = outboundReview.readGovernanceEvents(resolveStateStorePath());

    if (flags.eventType) {
      if (!AUDIT_EVENT_TYPES.has(flags.eventType)) {
        return { code: 1, text: `audit: unknown --event-type "${flags.eventType}". Known: ${[...AUDIT_EVENT_TYPES].join(', ')}`, data: null };
      }
      rows = rows.filter(r => r.event_type === flags.eventType);
    }
    if (flags.recipient) {
      const needle = String(flags.recipient).toLowerCase();
      rows = rows.filter(r => String((r.payload && r.payload.recipient) || '').toLowerCase().includes(needle));
    }
    if (flags.account) {
      const key = accountIdentity.accountKey(String(flags.account));
      rows = rows.filter(r => r.account_id === key);
    }
    if (flags.since) {
      const since = String(flags.since);
      rows = rows.filter(r => String(r.created_at || '') >= since);
    }
    rows = rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    if (flags.json) {
      return { code: 0, text: JSON.stringify(rows, null, 2), data: { rows } };
    }
    const counts = {};
    for (const r of rows) counts[r.event_type] = (counts[r.event_type] || 0) + 1;
    const head = `Governance audit: ${rows.length} row(s)${Object.keys(counts).length ? ` — ${Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join(', ')}` : ''}`;
    const body = rows.slice(0, 50).map(r => {
      const p = r.payload || {};
      const bits = [String(r.created_at || '').slice(0, 19), r.event_type];
      if (p.recipient) bits.push(p.recipient);
      if (r.account_id) bits.push(`[${r.account_id}]`);
      if (p.override_reason) bits.push(`OVERRIDE: ${p.override_reason}`);
      if (p.decision) bits.push(`decision: ${p.decision}`);
      return `  ${bits.join(' · ')}`;
    }).join('\n');
    return { code: 0, text: rows.length ? `${head}\n${body}${rows.length > 50 ? `\n  … ${rows.length - 50} more (use --json for the full export)` : ''}` : `${head} (no matching rows)`, data: { rows } };
  } catch (err) {
    return { code: 1, text: `audit failed: ${err.message}`, data: null };
  }
}

module.exports = { OUTCOME_TYPES, AUDIT_EVENT_TYPES, runOutcome, runTruth, runAudit };
