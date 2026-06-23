/*
 * ESCC blessed-path approval engine (NEW for ESCC, v1.1.0).
 *
 * The deterministic core of the "blessed" outbound path. Given a draft and the
 * contact's gathered CRM records, it runs the four gates and, on a clean pass
 * (or a logged human override), records the per-recipient approval token the
 * fail-closed send-gate then requires. On a block with no override it persists
 * the do-not-contact entries the gates produced (so the block is remembered) and
 * records NO token — so the send-gate blocks the eventual draft/send too.
 *
 * This is code, not a prompt: the token only exists because the gates actually
 * ran and passed. A drifted agent that skips this path never gets a token, and
 * the send-gate blocks it.
 */

'use strict';

const review = require('./outbound-review');
const gates = require('./outbound-gates');
const dnc = require('./do-not-contact');

/** Compact per-gate status map for the approval record. */
function summarizeGates(result) {
  const out = {};
  for (const [name, verdict] of Object.entries(result.gates)) out[name] = verdict.status;
  return out;
}

/**
 * Run the four gates on a draft and approve (record a token) or block.
 * @param {{draft:object, records?:object, sessionId?:string, now?:(string|Date),
 *   override?:string, stateDir?:string}} args
 * @returns {{approved:boolean, key:string, recipient:string, blocks:object[],
 *   warnings:object[], override:boolean, overrideReason?:string}}
 */
function approveOutbound(args = {}) {
  const draft = args.draft || {};
  const records = args.records || {};
  const sessionId = args.sessionId || null;
  const now = args.now || null;
  const override = args.override ? String(args.override) : null;
  const stateDir = args.stateDir;

  const recipient = String(draft.recipient || draft.to || '').trim();
  const key = review.outboundContentKey({ recipient, subject: draft.subject, body: draft.body });
  const result = gates.evaluateGates({ draft, records, now });

  if (result.pass) {
    review.recordApproval({ sessionId, key, recipient, confidence: 1, gates: summarizeGates(result), now, stateDir });
    return { approved: true, key, recipient, blocks: [], warnings: result.warnings, override: false };
  }

  if (override) {
    // Logged human override: approve despite the blocks, record the reason, and
    // do NOT persist the blocklist writes (the human is choosing to proceed).
    review.recordApproval({ sessionId, key, recipient, confidence: 1, gates: summarizeGates(result), overrideReason: override, now, stateDir });
    return { approved: true, key, recipient, blocks: result.blocks, warnings: result.warnings, override: true, overrideReason: override };
  }

  // Blocked, no override: remember the blocks so the eventual send is caught too,
  // and record NO approval token.
  for (const w of result.blocklistWrites) {
    const bkey = w.scope === 'account'
      ? (records.account_id || records.accountId || recipient)
      : recipient;
    if (bkey) {
      dnc.recordDoNotContact({ key: bkey, scope: w.scope, reason: w.reason, notBefore: w.not_before, sessionId, stateDir });
    }
  }
  return { approved: false, key, recipient, blocks: result.blocks, warnings: result.warnings, override: false };
}

module.exports = { approveOutbound, summarizeGates };
