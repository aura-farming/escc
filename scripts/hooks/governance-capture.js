#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/governance-capture.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*; converted to the ESCC hook contract
 * (synchronous run(raw, ctx)); ECC emitted events to stderr, ESCC PERSISTS them
 * as governance_events JSONL rows in the state store; sales event types
 * (bulk_send_attempt / unapproved_send / crm_destructive_op) added.
 */
/**
 * pre:governance-capture AND post:governance-capture
 *   matcher: Bash|Write|Edit|MultiEdit · profiles: standard, strict
 *
 * ENV-GATED: only acts when ESCC_GOVERNANCE_CAPTURE=1 (default OFF). When off it
 * returns undefined immediately and touches nothing.
 *
 * This is a CAPTURE/AUDIT hook — it NEVER blocks. It detects governance-relevant
 * events in the tool input and records each as a governance_events JSONL row
 * (the same shape the async state-store reader uses), then passes the tool
 * through. On any internal error it fails OPEN (returns {exitCode:0}).
 *
 * Captured event types:
 *   ECC-inherited:
 *     - secret_detected       hardcoded secret in the tool input
 *     - policy_violation      write/access to a policy-sensitive path
 *     - approval_requested    destructive/approval-gated shell command
 *     - hook_input_truncated  payload exceeded the safe inspection limit
 *   ESCC sales additions:
 *     - bulk_send_attempt     a send tool addressing many recipients at once
 *     - unapproved_send       a live-send tool invoked through Bash (curl/api)
 *     - crm_destructive_op    a CRM delete/archive in the tool input
 */

'use strict';

const crypto = require('crypto');

const {
  parseHookInput,
  getToolName,
  getToolInput,
  getSessionId,
  getFilePath,
  getEventName,
} = require('../lib/hook-input');
const { resolveStateStorePath } = require('../lib/state-store');

const GOVERNANCE_TABLE = 'governance_events';

// --- detection patterns (ECC-inherited) ---

const SECRET_PATTERNS = [
  { name: 'aws_key', pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/ },
  { name: 'generic_secret', pattern: /(?:secret|password|token|api[_-]?key)\s*[:=]\s*["'][^"']{8,}/i },
  { name: 'private_key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
];

// Shell commands that require governance approval (destructive / irreversible).
const APPROVAL_COMMANDS = [
  /git\s+push\s+.*--force/,
  /git\s+reset\s+--hard/,
  /rm\s+-rf?\s/,
  /DROP\s+(?:TABLE|DATABASE)/i,
  /DELETE\s+FROM\s+\w+\s*(?:;|$)/i,
];

// File paths that are policy-sensitive (secrets/credentials material).
const SENSITIVE_PATHS = [
  /\.env(?:\.|$)/,
  /credentials/i,
  /secrets?\./i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
];

// --- ESCC sales detection (from a Bash command line) ---

// A live outbound send issued via the shell (curl/http to a send endpoint, a
// mail CLI, etc.) — bypasses the MCP send-gate, so it is recorded as unapproved.
const UNAPPROVED_SEND_COMMANDS = [
  /\bcurl\b[^\n]*\b(send|messages?|mail|emails?|outbound)\b/i,
  /\b(sendmail|mailx|mutt|swaks)\b/i,
  /\b(sg<|sendgrid|mailgun|postmark|ses)\b[^\n]*\bsend\b/i,
];

// A CRM destructive operation expressed on a shell command line.
const CRM_DESTRUCTIVE_COMMANDS = [
  /\b(hubspot|crm)\b[^\n]*\b(delete|archive|destroy|remove)\b/i,
  /\b(DELETE|ARCHIVE)\b[^\n]*\b(deal|contact|company|account)s?\b/i,
];

const MAX_RECIPIENTS_BEFORE_BULK = 5; // mirror ESCC_BULK_SEND_MAX default

// Collect every string LEAF value (newline-joined) rather than JSON-stringifying
// the object — JSON.stringify escapes embedded quotes, which would defeat the
// secret patterns that anchor on a quote after `token=`/`password:` etc.
function collectStrings(value, out, depth) {
  if (depth > 6 || value == null) return;
  if (typeof value === 'string') { out.push(value); return; }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(String(k)); // keep key names (e.g. "password") in scan scope
      collectStrings(v, out, depth + 1);
    }
  }
}

function asText(toolInput) {
  if (toolInput && typeof toolInput === 'object') {
    const parts = [];
    collectStrings(toolInput, parts, 0);
    return parts.join('\n');
  }
  return String(toolInput || '');
}

/** Return the names of any secret patterns matched in `text`. */
function detectSecrets(text) {
  if (!text || typeof text !== 'string') return [];
  const found = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) found.push(name);
  }
  return found;
}

/** Return the source of any approval-gated command pattern matched. */
function detectApprovalRequired(command) {
  if (!command || typeof command !== 'string') return [];
  return APPROVAL_COMMANDS.filter(p => p.test(command)).map(p => p.source);
}

/** Is this file path policy-sensitive (secret/credential material)? */
function detectSensitivePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  return SENSITIVE_PATHS.some(p => p.test(filePath));
}

/** Count recipients referenced anywhere in the tool input (for bulk detection). */
function countRecipients(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return 0;
  const candidates = [
    toolInput.to, toolInput.recipients, toolInput.recipient,
    toolInput.bcc, toolInput.cc, toolInput.emails,
  ];
  let max = 0;
  for (const c of candidates) {
    if (Array.isArray(c)) {
      max = Math.max(max, c.length);
    } else if (typeof c === 'string' && c.trim()) {
      // comma/semicolon-separated address list
      const parts = c.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      max = Math.max(max, parts.length);
    }
  }
  return max;
}

/**
 * Inspect the parsed hook input and return the governance events to capture.
 * Pure: callers persist the returned descriptors.
 * @param {object} input parsed hook input
 * @param {{hookPhase?: string}} [context]
 * @returns {Array<{eventType:string, payload:object}>}
 */
function analyzeForGovernanceEvents(input, context = {}) {
  const events = [];
  const toolName = getToolName(input);
  const toolInput = getToolInput(input);
  const hookPhase = context.hookPhase || 'unknown';
  const inputText = asText(toolInput);

  // 1. Secret detection (ECC).
  const secrets = detectSecrets(inputText);
  if (secrets.length > 0) {
    events.push({
      eventType: 'secret_detected',
      payload: { toolName, hookPhase, secretTypes: secrets, location: 'input', severity: 'critical' },
    });
  }

  // 2. Approval-gated shell commands (ECC).
  const command = toolName === 'Bash' ? String(toolInput.command || '') : '';
  if (command) {
    const approval = detectApprovalRequired(command);
    if (approval.length > 0) {
      events.push({
        eventType: 'approval_requested',
        payload: { toolName, hookPhase, matchedPatterns: approval, severity: 'high' },
      });
    }
  }

  // 3. Policy violation: sensitive file path (ECC).
  const filePath = getFilePath(toolInput);
  if (filePath && detectSensitivePath(filePath)) {
    events.push({
      eventType: 'policy_violation',
      payload: { toolName, hookPhase, filePath: String(filePath).slice(0, 200), reason: 'sensitive_file_access', severity: 'warning' },
    });
  }

  // 4. Bulk send attempt (ESCC) — a send tool addressing many recipients.
  const isSendish = /send|outbound|email|message/i.test(toolName);
  const recipients = countRecipients(toolInput);
  if (isSendish && recipients > MAX_RECIPIENTS_BEFORE_BULK) {
    events.push({
      eventType: 'bulk_send_attempt',
      payload: { toolName, hookPhase, recipientCount: recipients, severity: 'high' },
    });
  }

  // 5. Unapproved send (ESCC) — a live send issued through the shell.
  if (command && UNAPPROVED_SEND_COMMANDS.some(p => p.test(command))) {
    events.push({
      eventType: 'unapproved_send',
      payload: { toolName, hookPhase, reason: 'shell_send_bypasses_gate', severity: 'high' },
    });
  }

  // 6. CRM destructive op (ESCC) — delete/archive of a CRM object, in input or shell.
  const crmDestructiveInInput = /\b(delete|archive|destroy|remove)\b/i.test(
    String(toolInput.operation || toolInput.action || toolInput.method || toolInput.op || '')
  ) && /\b(deal|contact|company|account|crm|hubspot|object)\b/i.test(inputText);
  const crmDestructiveInShell = !!command && CRM_DESTRUCTIVE_COMMANDS.some(p => p.test(command));
  if (crmDestructiveInInput || crmDestructiveInShell) {
    events.push({
      eventType: 'crm_destructive_op',
      payload: { toolName, hookPhase, reason: 'crm_delete_or_archive', severity: 'high' },
    });
  }

  return events;
}

/** Is the capture feature enabled? Default OFF. */
function isCaptureEnabled() {
  return String(process.env.ESCC_GOVERNANCE_CAPTURE || '').trim() === '1';
}

/**
 * Append a governance event row using the EXACT snake_case shape the async
 * state-store API writes: {id, session_id, event_type, payload, resolved_at,
 * resolution, created_at}. Synchronous; creates the state dir if needed.
 */
function appendGovernanceEvent(stateDir, { sessionId, eventType, payload }) {
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(stateDir, { recursive: true });
  const row = {
    id: crypto.randomUUID(),
    session_id: sessionId || null,
    event_type: eventType,
    payload: payload ?? null,
    resolved_at: null,
    resolution: null,
    created_at: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(stateDir, `${GOVERNANCE_TABLE}.jsonl`), `${JSON.stringify(row)}\n`);
  return row;
}

/** Map a hook event name to the compact phase tag ECC used. */
function phaseFor(eventName) {
  const n = String(eventName || '');
  if (n.startsWith('Pre')) return 'pre';
  if (n.startsWith('Post')) return 'post';
  return 'unknown';
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean, hookId?: string, stateDir?: string}} [ctx]
 * @returns {{exitCode:number}|{additionalContext:string}|undefined}
 */
function run(raw, ctx = {}) {
  // Env gate first — when off, do nothing.
  if (!isCaptureEnabled()) return undefined;

  try {
    const stateDir = ctx.stateDir || resolveStateStorePath();
    const input = parseHookInput(raw);
    const sessionId =
      getSessionId(input) ||
      process.env.ESCC_SESSION_ID ||
      process.env.CLAUDE_SESSION_ID ||
      null;
    const hookPhase = phaseFor(getEventName(input) || process.env.CLAUDE_HOOK_EVENT_NAME);

    // Record a truncation event so the audit trail notes the unverifiable payload.
    if (ctx && ctx.truncated) {
      appendGovernanceEvent(stateDir, {
        sessionId,
        eventType: 'hook_input_truncated',
        payload: { hookPhase, severity: 'warning' },
      });
      return undefined; // capture-only, never block
    }

    const events = analyzeForGovernanceEvents(input, { hookPhase });
    for (const ev of events) {
      appendGovernanceEvent(stateDir, { sessionId, eventType: ev.eventType, payload: ev.payload });
    }

    if (events.length > 0) {
      const types = [...new Set(events.map(e => e.eventType))].join(', ');
      return { additionalContext: `governance-capture: recorded ${events.length} event(s) [${types}].` };
    }
    return undefined;
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — never block a capture hook
  }
}

module.exports = {
  run,
  analyzeForGovernanceEvents,
  detectSecrets,
  detectApprovalRequired,
  detectSensitivePath,
  countRecipients,
  appendGovernanceEvent,
  isCaptureEnabled,
  SECRET_PATTERNS,
  APPROVAL_COMMANDS,
  SENSITIVE_PATHS,
};

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  try { run(raw, { truncated }); } catch (_err) { /* fail open */ }
  process.stdout.write(raw);
  process.exit(0);
}
