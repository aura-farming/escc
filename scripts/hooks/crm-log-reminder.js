#!/usr/bin/env node
/*
 * ESCC post:crm-log-reminder — nudge to log activity in HubSpot (NEW for ESCC).
 *
 * Fires after a sales-touch tool runs:
 *   - a Gmail draft is created       (mcp__claude_ai_Gmail__create_draft)
 *   - a Calendar event is created    (mcp__claude_ai_Google_Calendar__create_event)
 *   - a Fireflies transcript fetched (mcp__claude_ai_Fireflies__*)
 * and reminds the rep to record the matching activity on the HubSpot
 * contact/deal so the timeline stays accurate. The CRM is the source of truth;
 * an email/meeting/call that never lands on the timeline is invisible to RevOps
 * and to forecasting.
 *
 * Failure policy: PURE WARN — never blocks. Returns {additionalContext} for a
 * matched tool, undefined otherwise. Fails OPEN (exit 0) on any internal error.
 */
/**
 * post:crm-log-reminder
 *   matcher: Gmail create_draft | Calendar create_event | Fireflies fetch
 *   profiles: standard, strict
 */

'use strict';

const { parseHookInput, getToolName, getToolInput } = require('../lib/hook-input');

// Each rule: a tool-name matcher and a builder that turns the (best-effort)
// tool input into a specific nudge. Order matters only for first-match.
const REMINDERS = [
  {
    kind: 'gmail_draft',
    match: /create_draft/i,
    build: (toolInput) => {
      const recipient = firstRecipient(toolInput);
      const who = recipient ? ` to ${recipient}` : '';
      return (
        `You drafted an email${who} — once it's sent, log it as a HubSpot email activity ` +
        'on the contact/deal so the timeline stays accurate. (Gmail drafts do not sync to the CRM on their own.)'
      );
    },
  },
  {
    kind: 'calendar_event',
    match: /create_event/i,
    build: (toolInput) => {
      const title = firstString(toolInput, ['summary', 'title', 'subject', 'name']);
      const what = title ? ` ("${truncate(title, 60)}")` : '';
      return (
        `You created a calendar event${what} — log it as a HubSpot meeting on the contact/deal ` +
        'and set/confirm the deal next step so the opportunity does not stall.'
      );
    },
  },
  {
    kind: 'fireflies_transcript',
    match: /Fireflies/i,
    build: () =>
      'You fetched a call transcript — log the call as a HubSpot activity on the contact/deal, ' +
      'capture key takeaways/next steps, and update MEDDPICC fields the call surfaced.',
  },
];

/** Truncate a string for inline display. */
function truncate(value, max) {
  const s = String(value || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Return the first non-empty string among the given keys of toolInput. */
function firstString(toolInput, keys) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  for (const k of keys) {
    const v = toolInput[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Best-effort: pull a single recipient address/name for the draft nudge. */
function firstRecipient(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const candidates = [toolInput.to, toolInput.recipient, toolInput.recipients, toolInput.email];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      const first = c.find((x) => typeof x === 'string' && x.trim());
      if (first) return truncate(first.trim(), 80);
    }
    if (typeof c === 'string' && c.trim()) {
      // comma/semicolon-separated list → take the first address only
      const first = c.split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) return truncate(first, 80);
    }
  }
  return '';
}

/** Find the reminder rule matching this tool name, if any. */
function matchReminder(toolName) {
  const name = String(toolName || '');
  if (!name) return null;
  return REMINDERS.find((r) => r.match.test(name)) || null;
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean}} [ctx]
 * @returns {{exitCode:number}|{additionalContext:string}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const toolName = getToolName(input);
    const reminder = matchReminder(toolName);
    if (!reminder) return undefined; // not one of the three sales-touch tools

    // A truncated payload can't be mined for recipient/title detail, but the
    // tool-name match is enough to still emit the (generic) nudge.
    const toolInput = ctx && ctx.truncated ? {} : getToolInput(input);
    return { additionalContext: `📋 crm-log-reminder: ${reminder.build(toolInput)}` };
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — never block; this is a pure warn hook
  }
}

module.exports = { run, matchReminder, firstRecipient, firstString, REMINDERS };

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try { result = run(raw, { truncated }); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.additionalContext) process.stderr.write(`${result.additionalContext}\n`);
  process.stdout.write(raw);
  process.exit(0);
}
