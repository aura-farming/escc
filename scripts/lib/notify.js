/*
 * ESCC machinery: scripts/lib/notify.js
 *
 * Notification delivery layer (Amendment A.4). Closes the
 * "compute alerts but never deliver" gap: hooks/watchers compute severity but
 * had no path to actually surface or persist an alert.
 *
 * Hook subprocesses run as plain Node and CANNOT call MCP tools (Slack, Gmail)
 * directly. This module therefore routes by severity and delivers what Node can
 * do locally (desktop notifications), while QUEUEING higher-touch intents
 * (Slack / self-email / digest) as JSONL lines for a later MCP-capable
 * agent/step to drain and actually send.
 *
 * Pure CommonJS, no new dependencies. All delivery is fail-soft: this module
 * never throws as a result of a delivery failure.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolveStateDir } = require('./agent-data-home');

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];

const QUEUE_FILENAME = 'notifications.jsonl';

// Bound desktop notification text so a malformed/huge message can't blow up the
// osascript/notify-send invocation.
const MAX_DESKTOP_TITLE = 256;
const MAX_DESKTOP_BODY = 2000;

/**
 * Resolve the absolute path to the notifications queue file.
 * Honors ESCC_WATCH-style override (ESCC_NOTIFY_QUEUE) when present, otherwise
 * falls back to <state-dir>/notifications.jsonl. Does not require any env.
 * @returns {string} absolute path to the JSONL queue file
 */
function resolveQueuePath() {
  const override = process.env.ESCC_NOTIFY_QUEUE;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  return path.join(resolveStateDir(), QUEUE_FILENAME);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSeverity(severity) {
  const value = String(severity || '').trim().toLowerCase();
  return VALID_SEVERITIES.includes(value) ? value : 'low';
}

function clamp(value, max) {
  const str = value == null ? '' : String(value);
  return str.length > max ? str.slice(0, max) : str;
}

function isMac() {
  return process.platform === 'darwin';
}

function isLinux() {
  return process.platform === 'linux';
}

/**
 * Append a notification intent to the JSONL queue. Fail-soft: returns the queue
 * record on success, or null if the write could not be performed.
 * @param {object} record fully-formed queue record (sans status/ts defaults)
 * @returns {object|null}
 */
function appendToQueue(record) {
  const entry = {
    ts: record.ts || nowIso(),
    severity: record.severity,
    title: record.title,
    message: record.message,
    account: record.account || null,
    channel: record.channel,
    status: record.status || 'queued',
  };
  try {
    const queuePath = resolveQueuePath();
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    fs.appendFileSync(queuePath, JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  } catch (_err) {
    // Fail-soft: never throw on a delivery/persistence failure.
    return null;
  }
}

/**
 * Attempt a native desktop notification. Fail-soft and best-effort.
 * macOS -> osascript "display notification"; Linux -> notify-send if present.
 * @param {{ title: string, message: string }} args
 * @returns {boolean} true if a delivery mechanism was successfully invoked
 */
function deliverDesktop({ title, message }) {
  const safeTitle = clamp(title, MAX_DESKTOP_TITLE);
  const safeBody = clamp(message, MAX_DESKTOP_BODY);

  // Disabled via env (e.g. headless/CI). Treat as not-delivered, not an error.
  if (String(process.env.ESCC_NOTIFY_NO_DESKTOP || '').trim() === '1') {
    return false;
  }

  try {
    if (isMac()) {
      // Pass values as argv to osascript to avoid shell quoting/injection.
      // AppleScript string escaping: backslash and double-quote.
      const escAppleScript = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script =
        'display notification "' + escAppleScript(safeBody) + '"' +
        ' with title "' + escAppleScript(safeTitle) + '"';
      execFileSync('osascript', ['-e', script], { stdio: 'ignore', timeout: 5000 });
      return true;
    }
    if (isLinux()) {
      execFileSync('notify-send', [safeTitle, safeBody], { stdio: 'ignore', timeout: 5000 });
      return true;
    }
  } catch (_err) {
    // notify-send may be absent, or osascript may be sandboxed. Fail-soft.
    return false;
  }
  return false;
}

/**
 * Route + deliver a notification by severity.
 *
 * Routing:
 *  - critical -> desktop notification + queue Slack intent
 *  - high     -> queue Slack intent (+ desktop on macOS)
 *  - medium   -> append to digest queue (channel: "digest")
 *  - low      -> suppress: record only (channel: "digest", status: "suppressed")
 *
 * Delivery is fail-soft; the returned shape always reflects what actually
 * happened. `channels` may override the queue channel set per call.
 *
 * @param {object} opts
 * @param {('critical'|'high'|'medium'|'low')} opts.severity
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.account] account/context identifier
 * @param {string[]} [opts.channels] override channels to queue (e.g. ["slack","gmail-self"])
 * @returns {{ delivered: object[], queued: object[] }}
 */
function notify(opts = {}) {
  const severity = normalizeSeverity(opts.severity);
  const title = clamp(opts.title || '', MAX_DESKTOP_TITLE);
  const message = String(opts.message == null ? '' : opts.message);
  const account = opts.account == null ? null : String(opts.account);
  const channelOverride = Array.isArray(opts.channels) && opts.channels.length
    ? opts.channels.map((c) => String(c))
    : null;

  const delivered = [];
  const queued = [];

  const queueChannel = (channel, status) => {
    const entry = appendToQueue({ severity, title, message, account, channel, status });
    if (entry) queued.push(entry);
  };

  const doDesktop = () => {
    const ok = deliverDesktop({ title, message });
    if (ok) {
      delivered.push({
        ts: nowIso(),
        severity,
        title,
        message,
        account,
        channel: 'desktop',
        status: 'delivered',
      });
    }
  };

  if (severity === 'critical') {
    doDesktop();
    const channels = channelOverride || ['slack'];
    channels.forEach((c) => queueChannel(c, 'queued'));
  } else if (severity === 'high') {
    if (isMac()) doDesktop();
    const channels = channelOverride || ['slack'];
    channels.forEach((c) => queueChannel(c, 'queued'));
  } else if (severity === 'medium') {
    const channels = channelOverride || ['digest'];
    channels.forEach((c) => queueChannel(c, 'queued'));
  } else {
    // low: suppress — record only, never deliver.
    const channels = channelOverride || ['digest'];
    channels.forEach((c) => queueChannel(c, 'suppressed'));
  }

  return { delivered, queued };
}

/**
 * Drain queued notifications for an MCP-capable step to actually send.
 *
 * Reads the JSONL queue and returns parsed records. By default this is
 * non-destructive (the queue file is left intact); pass { clear: true } to
 * truncate the queue after a successful read (e.g. once an MCP step has taken
 * ownership of delivery). Fail-soft: returns [] if the queue is absent/unreadable.
 *
 * @param {object} [options]
 * @param {boolean} [options.clear=false] truncate the queue after reading
 * @param {boolean} [options.queuedOnly=true] return only status:"queued" records
 * @returns {object[]} parsed notification records
 */
function drainNotifications(options = {}) {
  const { clear = false, queuedOnly = true } = options;
  let raw;
  try {
    raw = fs.readFileSync(resolveQueuePath(), 'utf8');
  } catch (_err) {
    return [];
  }

  const records = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!queuedOnly || parsed.status === 'queued') {
        records.push(parsed);
      }
    } catch (_err) {
      // Skip malformed line; do not let one bad line abort the drain.
    }
  }

  if (clear) {
    try {
      fs.writeFileSync(resolveQueuePath(), '', 'utf8');
    } catch (_err) {
      // Fail-soft: returning the records is more important than truncation.
    }
  }

  return records;
}

module.exports = {
  notify,
  drainNotifications,
  resolveQueuePath,
  deliverDesktop,
  appendToQueue,
  VALID_SEVERITIES,
};
