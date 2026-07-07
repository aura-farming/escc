#!/usr/bin/env node
/*
 * pre:outbound-send-gate — the ONE fail-CLOSED hook in ESCC.
 *
 * Trust boundary, not a prompt: it enforces outbound safety at the TOOL boundary,
 * so a rogue/drifted agent that calls the external tools directly cannot bypass
 * escc's review (the gap that let ~40 unreviewed Gmail drafts + HubSpot writes
 * through before v1.1.0). It gates four kinds of outbound:
 *   - 'send'      live send tools  → bulk cap + an approval token OR legacy review;
 *   - 'draft'     a Gmail/MCP draft (the artifact a human then sends) → approval token;
 *   - 'crm-email' a HubSpot OUTBOUND email engagement → approval token;
 * and for every gated kind it also (a) blocks a recipient on the do-not-contact
 * list and (b) runs a cheap, no-network payload scan (egregious overclaim → hard
 * fail; advisory notes surfaced non-blocking). HubSpot tasks/notes/deals/reads are
 * NOT outbound and pass straight through (crm-write-guard handles those).
 *
 * The per-recipient approval token (recipient + content hash) is written by the
 * blessed path (email-outbound-ops / /escc-worklist) once the adversarial reviewer
 * + the four gates pass — so all history-based judgement happens earlier and this
 * hook stays fast (<~300ms, no network): it only enforces that it happened,
 * consults the blocklist, and inspects the payload.
 *
 * On ANY doubt — truncated input, unidentifiable tool, unreadable recipient/
 * content, missing approval, internal error — this hook BLOCKS (exit 2).
 * Escape hatch: ESCC_OUTBOUND_GATE=off (documented as dangerous).
 *
 * Return contract (run-with-flags): { exitCode: 2, stderr } blocks;
 * { additionalContext } passes with a non-blocking note; undefined passes through.
 */

'use strict';

const {
  parseHookInput,
  getToolName,
  getToolInput,
  getSessionId,
} = require('../lib/hook-input');
const review = require('../lib/outbound-review');
const dnc = require('../lib/do-not-contact');
const gates = require('../lib/outbound-gates');

function block(reason) {
  return { exitCode: 2, stderr: `[outbound-send-gate] BLOCKED: ${reason}` };
}

/**
 * Separation-of-duties branch (v1.8.0, ADDITIVE TIGHTENING ONLY): under the
 * strict hook profile — or ESCC_OVERRIDE_REQUIRES_MANAGER=1 on any profile —
 * an approval token that was minted via a human OVERRIDE must be signed by a
 * manager role. Non-override tokens (the four gates passed) are untouched,
 * and the standard profile behaves exactly as before.
 * @returns {string|null} a block reason, or null to proceed
 */
function overrideSodViolation(approval) {
  const payload = approval && approval.payload;
  if (!payload || !payload.override_reason) return null; // not an override token
  const strict = String(process.env.ESCC_HOOK_PROFILE || 'standard').trim().toLowerCase() === 'strict'
    || /^(1|true|on)$/i.test(String(process.env.ESCC_OVERRIDE_REQUIRES_MANAGER || ''));
  if (!strict) return null;
  const { isManagerRole } = require('../instincts/lifecycle');
  if (isManagerRole(payload.approver_role)) return null;
  return `this approval is an OVERRIDE ("${payload.override_reason}") but is not manager-signed (approver_role=${payload.approver_role || 'unset'}), and the strict profile requires separation of duties. Re-approve with --approver-role <manager role> by an actual manager.`;
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean, pluginRoot?: string}} [ctx]
 * @returns {{exitCode:number, stderr:string}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    // Documented dangerous escape hatch — only path that opens the gate wholesale.
    if (review.isGateOff()) {
      return undefined;
    }

    // Fail closed on a truncated payload: we cannot verify a review on a send
    // we cannot fully see.
    if (ctx && ctx.truncated) {
      return block('hook input was truncated; cannot verify outbound review (fail-closed). Retry or set ESCC_OUTBOUND_GATE=off to override.');
    }

    const input = parseHookInput(raw);
    const toolName = getToolName(input);

    // The matcher scopes this hook to send-capable tools. If we cannot even
    // identify the tool, we cannot prove this is NOT a live send → block.
    if (!toolName) {
      return block('could not identify the tool being called; refusing to assume it is safe (fail-closed).');
    }

    const config = review.loadOutboundToolsConfig(ctx.pluginRoot);
    const sessionId = getSessionId(input);
    const toolInput = getToolInput(input);
    const cls = review.classifyOutbound(toolName, toolInput, config);

    // Non-outbound tools (reads, HubSpot tasks/notes/deals, unrelated) pass through.
    if (cls.kind === 'allow' || cls.kind === 'other') {
      return undefined;
    }

    // The tool-agnostic content key + recipient shared by every gated kind.
    const recipient = cls.recipient ? String(cls.recipient) : '';
    const contentKey = review.outboundContentKey({ recipient, subject: cls.subject, body: cls.body });

    // --- do-not-contact blocklist (contact-level; account-level is enforced at
    // approval time — a blocked account never gets a token, so the approval
    // check below blocks it here too). ---
    if (recipient) {
      const blocked = dnc.findActiveBlock({ key: recipient });
      if (blocked) {
        const until = blocked.not_before ? ` (not before ${String(blocked.not_before).slice(0, 10)})` : ' (indefinite)';
        review.recordSendDecision({ sessionId, fingerprint: contentKey, decision: 'unapproved' });
        return block(`recipient is on the do-not-contact list — ${blocked.reason}${until}. Clear the block or wait until the not-before date before contacting them.`);
      }
    }

    // ONE governance read for the whole evaluation (v1.8.0 perf QW): the
    // bulk counter and both approval lookups share this snapshot instead of
    // each re-parsing the full log.
    const events = review.loadGovernanceEvents({});

    // --- legacy live-send tools: bulk cap, then an approval token OR a legacy review ---
    if (cls.kind === 'send') {
      const fingerprint = review.fingerprintOutbound(toolName, toolInput);
      const max = review.bulkMax();
      const alreadySent = review.countSends({ sessionId, events });
      if (alreadySent >= max) {
        review.recordSendDecision({ sessionId, fingerprint, decision: 'bulk' });
        return block(`bulk send cap reached (${alreadySent}/${max} sends this session via ESCC_BULK_SEND_MAX). Split the work across sessions or raise the cap deliberately.`);
      }
      const approved = review.findValidApproval({ key: contentKey, events })
        || review.findValidReview({ fingerprint, minConfidence: review.reviewMinConfidence(), events });
      if (!approved) {
        review.recordSendDecision({ sessionId, fingerprint, decision: 'unapproved' });
        return block(`no review-evidence marker for this outbound (tool=${toolName}). Run the blessed path (email-outbound-ops, or /escc-worklist for a batch) so it is reviewed and approved, then retry.`);
      }
      const sod = overrideSodViolation(approved);
      if (sod) {
        review.recordSendDecision({ sessionId, fingerprint, decision: 'unapproved' });
        return block(sod);
      }
      review.recordSendDecision({ sessionId, fingerprint, decision: 'allow' });
      return undefined;
    }

    // --- NEW gated kinds: 'draft' + 'crm-email' — require a per-recipient approval token ---
    if (!recipient || (!cls.subject && !cls.body)) {
      return block(`could not read the recipient/content of this ${cls.kind} to verify an escc review (fail-closed). Produce it through email-outbound-ops or /escc-worklist.`);
    }

    const approval = review.findValidApproval({ key: contentKey, events });
    if (!approval) {
      review.recordSendDecision({ sessionId, fingerprint: contentKey, decision: 'unapproved' });
      const what = cls.kind === 'crm-email' ? 'this outbound email' : 'this draft';
      return block(`${what} has not passed escc review. Run the blessed path first — email-outbound-ops for one message, or /escc-worklist for a batch — so the adversarial reviewer + the four gates approve it; then retry.`);
    }
    const sod = overrideSodViolation(approval);
    if (sod) {
      review.recordSendDecision({ sessionId, fingerprint: contentKey, decision: 'unapproved' });
      return block(sod);
    }

    // Cheap, no-network payload backstop: hard-fail an egregious overclaim even
    // when approved; surface lesser notes without blocking.
    const inspection = gates.inspectPayload({ recipient, subject: cls.subject, body: cls.body });
    if (inspection.block) {
      review.recordSendDecision({ sessionId, fingerprint: contentKey, decision: 'unapproved' });
      return block(inspection.block);
    }
    if (inspection.warnings && inspection.warnings.length) {
      return { additionalContext: `[outbound-send-gate] approved, with notes:\n  - ${inspection.warnings.join('\n  - ')}` };
    }
    return undefined;
  } catch (err) {
    // FAIL CLOSED on any unexpected error.
    return block(`internal error, blocking send to stay safe: ${err && err.message ? err.message : String(err)}`);
  }
}

module.exports = { run, overrideSodViolation };

// Standalone fallback (legacy spawn path). Guarded so that require()-ing this
// module from run-with-flags never registers stdin listeners or exits. Stays
// fail-closed: any error here still blocks.
if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_err) {
    raw = '';
  }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try {
    result = run(raw, { truncated, pluginRoot: process.env.ESCC_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT });
  } catch (err) {
    result = { exitCode: 2, stderr: `[outbound-send-gate] BLOCKED: internal error (fail-closed): ${err && err.message}` };
  }
  if (result && result.exitCode === 2) {
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exit(2);
  }
  process.stdout.write(raw);
  process.exit(0);
}
