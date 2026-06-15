#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/ecc-statusline.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*; the "dir" segment becomes "persona/workspace"
 * (the active sales persona + rep workspace) per ESCC spec §6.1.
 */

/**
 * ESCC Statusline — registered under settings.json "statusLine" (NOT a hook).
 *
 * Renders:  model | task | $cost Nt Nf Nm | persona/workspace | context ██░░ N%
 *
 * Reads the session-bridge file written by post:metrics-bridge
 * (escc-metrics-${sessionId}.json — the single statusline metrics source) and
 * the statusLine input JSON from stdin. The context bar uses ECC's color
 * thresholds: green <50, yellow <65, orange <80, red ≥80 (% used).
 *
 * HUD contract: schemas/hud-status-contract.schema.json.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeSessionId, readBridge, writeBridgeAtomic } = require('../lib/session-bridge');

// Claude Code auto-compacts with a buffer; subtract it so the bar reflects
// USABLE remaining context, matching what the user actually has to work with.
const AUTO_COMPACT_BUFFER_PCT = 16.5;
const MAX_STDIN = 1024 * 1024;

/**
 * Format elapsed time since an ISO timestamp.
 * @param {string} isoTimestamp
 * @returns {string} e.g. "5s", "12m", "1h23m", or "?" when unknown
 */
function formatDuration(isoTimestamp) {
  if (!isoTimestamp) return '?';
  const elapsed = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (elapsed < 0 || Number.isNaN(elapsed)) return '?';
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`;
}

/**
 * Build the ANSI context-usage bar from Claude Code's remaining-percentage.
 * @param {number|null|undefined} remaining raw remaining %
 * @returns {string} colored bar (leading space), or '' when unknown
 */
function buildContextBar(remaining) {
  if (remaining === null || remaining === undefined) return '';
  const usableRemaining = Math.max(
    0,
    ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100
  );
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
  const filled = Math.floor(used / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  if (used < 50) return ` \x1b[32m${bar} ${used}%\x1b[0m`;
  if (used < 65) return ` \x1b[33m${bar} ${used}%\x1b[0m`;
  if (used < 80) return ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
  return ` \x1b[1;31m${bar} ${used}%\x1b[0m`;
}

/**
 * The "persona/workspace" segment. Persona = active sales persona
 * (ESCC_PERSONA env or bridge.persona); workspace = rep workspace name
 * (bridge.workspace_name) or the directory basename as a fallback.
 * @param {object|null} bridge
 * @param {string} dir current working directory
 * @returns {string}
 */
function buildPersonaWorkspace(bridge, dir) {
  const persona = (process.env.ESCC_PERSONA || (bridge && bridge.persona) || '').trim();
  const workspace = (bridge && bridge.workspace_name) || (dir ? path.basename(dir) : '');
  if (persona && workspace) return `${persona}/${workspace}`;
  return persona || workspace || '';
}

/**
 * Read the current in-progress task's activeForm from the todos directory.
 * @param {string} sessionId
 * @returns {string}
 */
function readCurrentTask(sessionId) {
  try {
    const safeSessionId = sanitizeSessionId(sessionId);
    if (!safeSessionId) return '';
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const todosDir = path.join(claudeDir, 'todos');
    if (!fs.existsSync(todosDir)) return '';
    const files = fs
      .readdirSync(todosDir)
      .filter(f => f.startsWith(safeSessionId) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return '';
    const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
    const inProgress = Array.isArray(todos) ? todos.find(t => t.status === 'in_progress') : null;
    return (inProgress && inProgress.activeForm) || '';
  } catch (_err) {
    return '';
  }
}

/**
 * Build the metrics segment ("$cost Nt Nf Nm") from the bridge.
 * @param {object|null} bridge
 * @returns {string} ANSI-wrapped metrics string, or '' when empty
 */
function buildMetrics(bridge) {
  if (!bridge) return '';
  const parts = [];
  if (bridge.total_cost_usd > 0) parts.push(`$${bridge.total_cost_usd.toFixed(2)}`);
  if (bridge.tool_count > 0) parts.push(`${bridge.tool_count}t`);
  if (bridge.files_modified_count > 0) parts.push(`${bridge.files_modified_count}f`);
  const dur = formatDuration(bridge.first_timestamp);
  if (dur !== '?') parts.push(dur);
  return parts.length > 0 ? `\x1b[38;5;117m${parts.join(' ')}\x1b[0m` : '';
}

/**
 * Assemble the full statusline string. Pure (no IO) so it is unit-testable.
 * @param {{model:string, task:string, metrics:string, personaWorkspace:string, ctx:string}} segmentsIn
 * @returns {string}
 */
function composeStatusline({ model, task, metrics, personaWorkspace, ctx }) {
  const segments = [`\x1b[2m${model}\x1b[0m`];
  if (task) segments.push(`\x1b[1;97m${task}\x1b[0m`);
  if (metrics) segments.push(metrics);
  if (personaWorkspace) segments.push(`\x1b[2m${personaWorkspace}\x1b[0m`);
  return segments.join(' \x1b[2m│\x1b[0m ') + (ctx || '');
}

function runStatusline() {
  let input = '';
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (input.length < MAX_STDIN) input += chunk.substring(0, MAX_STDIN - input.length);
  });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);
      const model = (data.model && data.model.display_name) || 'Claude';
      const dir = (data.workspace && data.workspace.current_dir) || process.cwd();
      const session = data.session_id || '';
      const remaining = data.context_window && data.context_window.remaining_percentage;

      const sessionId = sanitizeSessionId(session);
      const bridge = sessionId ? readBridge(sessionId) : null;

      // Write context % back to the bridge so context-monitor can read it.
      if (sessionId && bridge && remaining !== null && remaining !== undefined) {
        bridge.context_remaining_pct = remaining;
        try { writeBridgeAtomic(sessionId, bridge); } catch (_err) { /* best effort */ }
      }

      const out = composeStatusline({
        model,
        task: sessionId ? readCurrentTask(sessionId) : '',
        metrics: buildMetrics(bridge),
        personaWorkspace: buildPersonaWorkspace(bridge, dir),
        ctx: buildContextBar(remaining),
      });
      process.stdout.write(out);
    } catch (_err) {
      // Silent fail — a statusline must never disrupt the session.
    }
  });
}

module.exports = {
  formatDuration,
  buildContextBar,
  buildPersonaWorkspace,
  buildMetrics,
  composeStatusline,
  readCurrentTask,
  MAX_STDIN,
};

if (require.main === module) runStatusline();
