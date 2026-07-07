/*
 * ESCC outcome-capture bridge (NEW for ESCC; ADR-0018 / the v1.8.0 learning
 * loop keystone).
 *
 * The instinct engine's outcome-weighting (distill.applyOutcomeWeighting, I2)
 * was fully built but STARVED: insertOutcome had zero production callers, so
 * the outcomes ledger stayed empty and the harness never actually got smarter.
 * This module fills the ledger deterministically from tool calls the rep
 * already makes:
 *
 *   - a HubSpot deal STAGE write        -> deal_stage_advanced / closed_won /
 *                                          closed_lost
 *   - a Google Calendar event creation  -> meeting_booked
 *   - a rep-attested reply              -> reply_received (via
 *                                          `escc outcome record`; an inbound
 *                                          reply has no tool call to hook)
 *
 * Payloads are SANITIZED to a whitelist of small structured fields — never
 * free text from the tool input, so a prospect-authored string can never ride
 * an outcome row into the learning stores (ADR-0012 discipline).
 */

'use strict';

const crypto = require('crypto');

const identity = require('./account-identity');

const HUBSPOT_MANAGE = 'mcp__hubspot__manage_crm_objects';
const CALENDAR_CREATE = 'mcp__claude_ai_Google_Calendar__create_event';

const WON_RE = /clos(?:ed)?[\s_-]*won|\bwon\b/i;
const LOST_RE = /clos(?:ed)?[\s_-]*lost|\blost\b/i;

function getProps(toolInput) {
  const ti = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const p = ti.properties || ti.props || ti.fields || ti.values;
  return p && typeof p === 'object' ? p : {};
}

function isDealObject(toolInput) {
  const t = String((toolInput && (toolInput.objectType ?? toolInput.object_type ?? toolInput.objectTypeId)) || '').toLowerCase();
  return /^deals?$/.test(t) || t === '0-3';
}

/** First attendee email on a calendar payload (shapes vary by connector). */
function firstAttendeeEmail(toolInput) {
  const ti = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const list = Array.isArray(ti.attendees) ? ti.attendees : [];
  for (const a of list) {
    const email = typeof a === 'string' ? a : a && a.email;
    if (email && /@/.test(String(email))) return String(email);
  }
  return null;
}

/**
 * Classify a PostToolUse call as an outcome. Returns null for anything that
 * is not one (non-deal CRM writes, stage-less deal edits, unrelated tools).
 * @returns {{type, deal_id, account_id, payload}|null}
 */
function classify(toolName, toolInput) {
  const name = String(toolName || '');

  if (name === HUBSPOT_MANAGE) {
    if (!isDealObject(toolInput)) return null;
    const props = getProps(toolInput);
    const stage = props.dealstage ?? props.stage ?? props.hs_pipeline_stage ?? null;
    if (stage == null || stage === '') return null; // not a stage write -> not an outcome
    const stageStr = String(stage);
    const type = WON_RE.test(stageStr) ? 'closed_won' : LOST_RE.test(stageStr) ? 'closed_lost' : 'deal_stage_advanced';
    const ti = toolInput && typeof toolInput === 'object' ? toolInput : {};
    const dealId = ti.objectId ?? ti.object_id ?? ti.id ?? ti.dealId ?? null;
    const accountRaw = props.account_id ?? ti.accountId ?? ti.account_id ?? null;
    return {
      type,
      deal_id: dealId != null ? String(dealId) : null,
      account_id: accountRaw ? identity.accountKey(String(accountRaw)) : null,
      // Whitelisted structured fields only — the stage VALUE is a CRM enum,
      // not prospect prose, and is what the learning loop keys on.
      payload: { source_tool: 'hubspot', stage: stageStr.slice(0, 60) },
    };
  }

  if (name === CALENDAR_CREATE) {
    const email = firstAttendeeEmail(toolInput);
    return {
      type: 'meeting_booked',
      deal_id: null,
      account_id: email ? identity.accountKey(email) : null,
      payload: { source_tool: 'calendar' },
    };
  }

  return null;
}

/**
 * Classify and, when it IS an outcome, insert it into the ledger.
 * @param {{toolName:string, toolInput:object, sessionId?:string}} args
 * @param {{store?:object}} [options] injectable store for tests
 * @returns {object|null} the inserted outcome (normalized) or null
 */
function capture(args = {}, options = {}) {
  const classified = classify(args.toolName, args.toolInput);
  if (!classified) return null;

  const outcome = {
    id: `oc-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
    type: classified.type,
    account_id: classified.account_id,
    deal_id: classified.deal_id,
    session_id: args.sessionId || null,
    payload: classified.payload,
  };

  if (options.store) return options.store.insertOutcome(outcome);
  const { createStateStoreSync } = require('./state-store');
  const store = createStateStoreSync();
  try {
    return store.insertOutcome(outcome);
  } finally {
    store.close();
  }
}

module.exports = { HUBSPOT_MANAGE, CALENDAR_CREATE, classify, capture };
