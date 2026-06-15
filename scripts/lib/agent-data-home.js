/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/agent-data-home.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 */

/**
 * Resolve ESCC agent data home (memory persistence root) for Claude Code.
 *
 * ESCC is Claude Code only: env var > default ~/.claude. Project-dir
 * resolution honors CLAUDE_PROJECT_DIR.
 */

'use strict';

const path = require('path');

const AGENT_DATA_HOME_ENV = 'ESCC_AGENT_DATA_HOME';
const DEFAULT_CLAUDE_DIR_NAME = '.claude';

/**
 * Home directory for tilde expansion and default agent-data paths.
 * HOME/USERPROFILE, then os.homedir().
 */
function getHomeDirFromEnv() {
  const explicitHome = process.env.HOME || process.env.USERPROFILE;
  if (explicitHome && String(explicitHome).trim().length > 0) {
    return path.resolve(explicitHome);
  }
  return require('os').homedir();
}

function expandHomePath(value, baseDir) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('~')) {
    const remainder = trimmed.slice(1).replace(/^[/\\]+/, '');
    return remainder ? path.join(getHomeDirFromEnv(), remainder) : getHomeDirFromEnv();
  }
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  const base = baseDir && String(baseDir).trim()
    ? path.resolve(baseDir)
    : process.cwd();
  return path.resolve(base, trimmed);
}

function getDefaultClaudeAgentDataHome() {
  return path.join(getHomeDirFromEnv(), DEFAULT_CLAUDE_DIR_NAME);
}

function resolveProjectDir() {
  const candidate = process.env.CLAUDE_PROJECT_DIR;
  if (candidate && typeof candidate === 'string' && candidate.trim()) {
    return path.resolve(candidate);
  }
  return process.cwd();
}

/**
 * Resolve agent data home without mutating process.env.
 * Order: env (ESCC_AGENT_DATA_HOME) > default ~/.claude.
 * @returns {string} Absolute agent data home path
 */
function resolveAgentDataHome(options = {}) {
  const fromEnv = expandHomePath(process.env[AGENT_DATA_HOME_ENV]);
  if (fromEnv) return fromEnv;

  return getDefaultClaudeAgentDataHome();
}

/**
 * Resolve the ESCC state directory under the agent data home.
 * Used by the state-store.
 * @returns {string} Absolute path to <agentDataHome>/escc/state
 */
function resolveStateDir(options = {}) {
  return path.join(resolveAgentDataHome(options), 'escc', 'state');
}

/**
 * Set ESCC_AGENT_DATA_HOME on the current process when unset (hook subprocess safety net).
 * @returns {string} Resolved agent data home
 */
function ensureAgentDataHomeEnv(options = {}) {
  const resolved = resolveAgentDataHome(options);
  if (!expandHomePath(process.env[AGENT_DATA_HOME_ENV])) {
    process.env[AGENT_DATA_HOME_ENV] = resolved;
  }
  return resolved;
}

module.exports = {
  AGENT_DATA_HOME_ENV,
  DEFAULT_CLAUDE_DIR_NAME,
  expandHomePath,
  getDefaultClaudeAgentDataHome,
  resolveProjectDir,
  resolveAgentDataHome,
  resolveStateDir,
  ensureAgentDataHomeEnv,
};
