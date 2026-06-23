/*
 * ESCC worklist review-pack builder (NEW for ESCC, v1.1.0).
 *
 * The deterministic spine of the /escc-worklist batch orchestrator. Given a list
 * of { id, draft, records } items (assembled by the skill from a HubSpot worklist
 * — research + draft per account), it runs the four gates over each and splits
 * the list into a SENDABLE set and an EXCLUDED set (each with its reasons).
 *
 * Read-only: it writes no approval tokens. The consolidated pack goes to a human;
 * on approval, each sendable item is sent through the blessed gated path
 * (outbound-approve → the send-gate), which is where tokens are minted.
 */

'use strict';

const gates = require('./outbound-gates');

/**
 * Split a worklist into sendable vs excluded-with-reasons. Never throws on a bad
 * item — it is excluded with the error as its reason (so one malformed entry
 * cannot sink the batch).
 * @param {Array<{id?:string, draft:object, records?:object}>} items
 * @param {{now?:(string|Date)}} [options]
 */
function buildReviewPack(items = [], options = {}) {
  const now = options.now || null;
  const sendable = [];
  const excluded = [];

  items.forEach((item, i) => {
    const entry = item || {};
    const id = entry.id != null ? entry.id : i;
    const draft = entry.draft || {};
    const recipient = draft.recipient || draft.to || null;

    let result;
    try {
      result = gates.evaluateGates({ draft, records: entry.records || {}, now });
    } catch (err) {
      excluded.push({ id, recipient, reasons: [`gate evaluation error: ${err && err.message ? err.message : String(err)}`] });
      return;
    }

    if (result.pass) {
      sendable.push({ id, recipient, warnings: result.warnings.map(w => w.reason) });
    } else {
      excluded.push({ id, recipient, reasons: result.blocks.map(b => `${b.gate}: ${b.reason}`) });
    }
  });

  return {
    total: items.length,
    sendableCount: sendable.length,
    excludedCount: excluded.length,
    sendable,
    excluded,
  };
}

module.exports = { buildReviewPack };
