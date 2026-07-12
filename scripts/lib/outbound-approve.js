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
const identity = require('./account-identity');

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
  // Separation of duties (v1.8.0): who is approving, in what role. Defaults
  // come from the rep-identity env surface; recorded on every token.
  const approver = args.approver || process.env.ESCC_REP_IDENTITY || null;
  const approverRole = args.approverRole
    || process.env.ESCC_ROLE || process.env.ESCC_REP_ROLE || 'rep';

  const recipient = String(draft.recipient || draft.to || '').trim();
  const key = review.outboundContentKey({ recipient, subject: draft.subject, body: draft.body });
  // Canonical account key (ADR-0018): the supplied account id when present,
  // else the recipient's email resolves to its domain/company identity.
  const accountId = identity.accountKey(records.account_id || records.accountId || recipient) || null;
  const result = gates.evaluateGates({ draft, records, now });
  // ADR-0020: the adversarial reviewer is part of the sanctioned path, not an
  // optional layer. A clean-gates draft with no (or a failing) reviewer verdict
  // is blocked exactly like a gate failure — unless review enforcement is OFF or
  // a logged override proceeds. The attestation, when present, is recorded on the
  // token so "approved WITH what review?" is auditable.
  const reviewCheck = review.evaluateReviewAttestation(args.review);
  const attestation = reviewCheck.attestation || null;
  const blocks = result.blocks.slice();
  if (!reviewCheck.ok) blocks.push({ gate: 'adversarial-review', reason: reviewCheck.reason });

  if (result.pass && reviewCheck.ok) {
    review.recordApproval({ sessionId, key, recipient, accountId, approver, approverRole, confidence: 1, review: attestation, gates: summarizeGates(result), now, stateDir });
    return { approved: true, key, recipient, blocks: [], warnings: result.warnings, override: false, review: attestation };
  }

  if (override) {
    // Separation of duties (v1.8.0, opt-in tightening): under strict profile —
    // or ESCC_OVERRIDE_REQUIRES_MANAGER=1 — an override must come from a
    // manager role. Refused overrides record NO token and write NO blocklist
    // rows (a human is mid-decision; re-run with a manager to proceed).
    const requiresManager = String(process.env.ESCC_HOOK_PROFILE || 'standard').trim().toLowerCase() === 'strict'
      || /^(1|true|on)$/i.test(String(process.env.ESCC_OVERRIDE_REQUIRES_MANAGER || ''));
    if (requiresManager && !require('../instincts/lifecycle').isManagerRole(approverRole)) {
      return {
        approved: false,
        key,
        recipient,
        blocks: [...blocks, { gate: 'override-sod', reason: `override requires a manager role under the strict profile (approver_role=${approverRole}). Re-run with --approver-role <manager|revops|vp|cro> as the approving manager.` }],
        warnings: result.warnings,
        override: false,
        sodRefused: true,
        review: attestation,
      };
    }
    // Logged human override: approve despite the blocks, record the reason, and
    // do NOT persist the blocklist writes (the human is choosing to proceed).
    review.recordApproval({ sessionId, key, recipient, accountId, approver, approverRole, confidence: 1, review: attestation, gates: summarizeGates(result), overrideReason: override, now, stateDir });
    try {
      // Escalation visibility: every override lands in the notify queue.
      require('./notify').notify({
        severity: 'high',
        title: 'ESCC outbound override',
        message: `Override by ${approver || '(unattributed)'} (${approverRole}) for ${recipient}: ${override}`,
        account: accountId,
      });
    } catch (_err) {
      /* notification is best-effort; the governance row is the record */
    }
    return { approved: true, key, recipient, blocks, warnings: result.warnings, override: true, overrideReason: override, review: attestation };
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
  return { approved: false, key, recipient, blocks, warnings: result.warnings, override: false, review: attestation };
}

module.exports = { approveOutbound, summarizeGates };
