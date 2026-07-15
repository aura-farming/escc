'use strict';

/*
 * ESCC scheduled-autonomy verbs — `escc watch --emit/--install-schedule` and
 * `escc notify drain` (v1.8.0). Extracted from the escc.js dispatcher so the
 * router stays a thin, under-cap module; uniform { code, text, data } contract.
 *
 * The --approve-self path mints a SELF-DIGEST approval token only — recipient =
 * the operator's own mailbox, content = exactly the digest body printed — so
 * the fail-closed send-gate admits that one Gmail draft and nothing else.
 */

const accountIdentity = require('./account-identity');

/**
 * Watch scheduling (v1.8.0 autonomy): emit or install the OS scheduler wiring
 * for the read-only sweep. Emission prints; --install-schedule writes ONE
 * plist file and prints the single load command — nothing registers silently.
 */
function runWatchSchedule(flags) {
  const scheduleEmit = require('./schedule-emit');
  const intervalSeconds = scheduleEmit.parseIntervalSeconds(flags.interval);
  if (flags.installSchedule) {
    if (process.platform !== 'darwin') {
      return { code: 1, text: `--install-schedule writes a macOS launchd plist; on this platform add the crontab line yourself:\n  ${scheduleEmit.emitCrontabLine({ intervalSeconds })}`, data: null };
    }
    const r = scheduleEmit.installLaunchd({ intervalSeconds });
    return { code: 0, text: `Wrote ${r.plistPath} (every ${intervalSeconds}s).\nActivate it with:\n  ${r.loadCommand}\nRemove later with: launchctl unload ${r.plistPath} && rm ${r.plistPath}`, data: r };
  }
  const text = [
    `Scheduled watch wiring (every ${intervalSeconds}s):`,
    '',
    '# macOS — save as ~/Library/LaunchAgents/com.escc.watch.plist, then `launchctl load -w <path>`',
    scheduleEmit.emitLaunchdPlist({ intervalSeconds }),
    '# Linux/other — add to `crontab -e`:',
    scheduleEmit.emitCrontabLine({ intervalSeconds }),
  ].join('\n');
  return { code: 0, text, data: { intervalSeconds } };
}

/**
 * Notify-queue drain (v1.8.0 autonomy): print queued escalations for delivery.
 * --approve-self <your-email> additionally mints a SELF-DIGEST approval token
 * (recipient = the operator's own mailbox, content = exactly the digest body
 * printed) so the fail-closed send-gate admits the matching Gmail draft. The
 * gate itself is untouched — this is a blessed token for a self-addressed
 * digest, unusable for any other recipient or content.
 */
function runNotify(positional, flags) {
  const action = positional[0] || 'drain';
  if (action !== 'drain') {
    return { code: 1, text: `notify: unknown action '${action}' (drain)`, data: null };
  }
  try {
    const notifyLib = require('./notify');
    const records = notifyLib.drainNotifications({ clear: Boolean(flags.clear) });
    if (!records.length) {
      return { code: 0, text: 'Notify queue: empty.', data: { records: [] } };
    }
    const subject = `ESCC digest — ${records.length} queued notification(s)`;
    const body = records
      .map(r => `- [${r.severity || 'medium'}] ${r.message || r.title || '(no message)'}${r.account ? ` (${r.account})` : ''}`)
      .join('\n');
    const lines = [`Notify queue (${records.length})${flags.clear ? ' — CLEARED after read' : ''}:`, body];

    if (flags.approveSelf) {
      const email = String(flags.approveSelf).trim();
      if (!/@/.test(email)) return { code: 1, text: `--approve-self requires your own email address (got "${email}").`, data: null };
      const key = require('./outbound-review').outboundContentKey({ recipient: email, subject, body });
      require('./outbound-review').recordApproval({
        key,
        recipient: email,
        accountId: accountIdentity.accountKey(email),
        confidence: 1,
        verdict: 'approved',
        gates: { self_digest: 'pass' },
        approver: process.env.ESCC_REP_IDENTITY || email,
        approverRole: process.env.ESCC_ROLE || process.env.ESCC_REP_ROLE || 'rep',
      });
      lines.push('', `Self-digest approval token minted for ${email}. Create the Gmail draft with EXACTLY:`, `  subject: ${subject}`, '  body:', body.split('\n').map(l => `    ${l}`).join('\n'));
    }
    return { code: 0, text: lines.join('\n'), data: { records, subject, body } };
  } catch (err) {
    return { code: 1, text: `notify drain failed: ${err.message}`, data: null };
  }
}

module.exports = { runWatchSchedule, runNotify };
