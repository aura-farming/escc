/*
 * ESCC scheduler emit/install (NEW for ESCC; v1.8.0 autonomy).
 *
 * `escc watch` was a one-shot sweep that only ran when a human opened a
 * session — zero scheduled autonomy shipped. This module generates (and on
 * macOS installs) the OS scheduler wiring so the watch sweep runs on a
 * cadence: a launchd plist for macOS, a crontab line elsewhere. Emission is
 * pure string generation (unit-testable); installation writes ONE file under
 * the user's LaunchAgents and tells them the single load command — it never
 * silently registers anything.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_INTERVAL_SECONDS = 3600; // 1h — the trigger-watch cadence default
const LAUNCHD_LABEL = 'com.escc.watch';

/** Parse "30m" / "1h" / "3600" (seconds) into seconds; invalid -> default. */
function parseIntervalSeconds(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return DEFAULT_INTERVAL_SECONDS;
  const m = s.match(/^(\d+)\s*(s|m|h)?$/);
  if (!m) return DEFAULT_INTERVAL_SECONDS;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_INTERVAL_SECONDS;
  const unit = m[2] || 's';
  return unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
}

function esccEntrypoint(pluginRoot) {
  return path.join(pluginRoot || path.resolve(__dirname, '..', '..'), 'scripts', 'escc.js');
}

/** launchd plist running `escc watch` every N seconds (macOS). */
function emitLaunchdPlist({ intervalSeconds = DEFAULT_INTERVAL_SECONDS, pluginRoot, nodePath } = {}) {
  const node = nodePath || process.execPath;
  const entry = esccEntrypoint(pluginRoot);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${entry}</string>
    <string>watch</string>
  </array>
  <key>StartInterval</key><integer>${intervalSeconds}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardErrorPath</key><string>/tmp/escc-watch.err.log</string>
</dict>
</plist>
`;
}

/** crontab line running `escc watch` (Linux / manual installs). */
function emitCrontabLine({ intervalSeconds = DEFAULT_INTERVAL_SECONDS, pluginRoot, nodePath } = {}) {
  const node = nodePath || process.execPath;
  const entry = esccEntrypoint(pluginRoot);
  const minutes = Math.max(1, Math.min(59, Math.round(intervalSeconds / 60)));
  const cadence = intervalSeconds >= 3600
    ? `0 */${Math.max(1, Math.round(intervalSeconds / 3600))} * * *`
    : `*/${minutes} * * * *`;
  return `${cadence} ${node} ${entry} watch`;
}

/**
 * Install the launchd plist under the user's LaunchAgents (macOS). Writes the
 * file only — loading is one explicit user command, printed by the caller.
 * @returns {{plistPath: string, loadCommand: string}}
 */
function installLaunchd({ intervalSeconds, pluginRoot, nodePath, homeDir } = {}) {
  const home = homeDir || process.env.HOME || require('os').homedir();
  const dir = path.join(home, 'Library', 'LaunchAgents');
  fs.mkdirSync(dir, { recursive: true });
  const plistPath = path.join(dir, `${LAUNCHD_LABEL}.plist`);
  fs.writeFileSync(plistPath, emitLaunchdPlist({ intervalSeconds, pluginRoot, nodePath }), 'utf8');
  return { plistPath, loadCommand: `launchctl load -w ${plistPath}` };
}

module.exports = {
  DEFAULT_INTERVAL_SECONDS,
  LAUNCHD_LABEL,
  parseIntervalSeconds,
  emitLaunchdPlist,
  emitCrontabLine,
  installLaunchd,
};
