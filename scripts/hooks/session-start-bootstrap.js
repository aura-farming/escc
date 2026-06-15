#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/session-start-bootstrap.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Simplified for ESCC: single `escc` plugin slug (no legacy slug walk),
 * re-namespaced ECC_*->ESCC_*. Claude Code supplies ${CLAUDE_PLUGIN_ROOT}
 * natively, so this bootstrap is a thin fallback resolver for the one event
 * (SessionStart) where the env var is not guaranteed to be present yet.
 */
'use strict';

/**
 * Bootstrap loader for the ESCC SessionStart hook.
 *
 * SessionStart must route through `scripts/hooks/run-with-flags.js` so that the
 * hook-profile gating and the stdin cap (ESCC_HOOK_INPUT_MAX_BYTES) apply to
 * session-start.js exactly as they do for every other hook. This wrapper exists
 * because at SessionStart the CLAUDE_PLUGIN_ROOT env var is not always populated
 * before the hook fires; it resolves the plugin root from a small set of
 * well-known locations and then delegates.
 *
 * Failure policy: fail-open. If the plugin root or runner cannot be found, emit
 * a warning to stderr and pass stdin through unchanged so the session continues.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_SLUG = 'escc';
const RUNNER_REL = path.join('scripts', 'hooks', 'run-with-flags.js');

// Read the raw JSON event from stdin (fd 0).
let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch (_err) {
  raw = '';
}

/**
 * A candidate is a valid plugin root when the run-with-flags runner exists in it.
 * @param {unknown} candidate
 * @returns {boolean}
 */
function hasRunnerRoot(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  return value.length > 0 && fs.existsSync(path.join(path.resolve(value), RUNNER_REL));
}

/**
 * Resolve the ESCC plugin root:
 *   1. CLAUDE_PLUGIN_ROOT (native — the normal path)
 *   2. ESCC_PLUGIN_ROOT (set by run-with-flags for nested spawns)
 *   3. ~/.claude (direct install)
 *   4. ~/.claude/plugins/{escc, escc@escc, marketplaces/escc}
 *   5. versioned cache ~/.claude/plugins/cache/escc/<org>/<version>/
 * Returns '' when nothing resolves (caller fails open).
 * @returns {string}
 */
function resolvePluginRoot() {
  for (const envName of ['CLAUDE_PLUGIN_ROOT', 'ESCC_PLUGIN_ROOT']) {
    const envRoot = process.env[envName] || '';
    if (hasRunnerRoot(envRoot)) {
      return path.resolve(envRoot.trim());
    }
  }

  const home = require('os').homedir();
  const claudeDir = path.join(home, '.claude');
  if (hasRunnerRoot(claudeDir)) {
    return claudeDir;
  }

  const knownPaths = [
    [PLUGIN_SLUG],
    [`${PLUGIN_SLUG}@${PLUGIN_SLUG}`],
    ['marketplaces', PLUGIN_SLUG],
  ].map(segments => path.join(claudeDir, 'plugins', ...segments));

  for (const candidate of knownPaths) {
    if (hasRunnerRoot(candidate)) {
      return candidate;
    }
  }

  try {
    const cacheBase = path.join(claudeDir, 'plugins', 'cache', PLUGIN_SLUG);
    for (const org of fs.readdirSync(cacheBase, { withFileTypes: true })) {
      if (!org.isDirectory()) continue;
      for (const version of fs.readdirSync(path.join(cacheBase, org.name), { withFileTypes: true })) {
        if (!version.isDirectory()) continue;
        const candidate = path.join(cacheBase, org.name, version.name);
        if (hasRunnerRoot(candidate)) {
          return candidate;
        }
      }
    }
  } catch (_err) {
    // cache directory may not exist; that's fine.
  }

  return '';
}

const root = resolvePluginRoot();

if (!root) {
  process.stderr.write('[SessionStart] WARNING: could not resolve ESCC plugin root; skipping session-start hook\n');
  process.stdout.write(raw);
  process.exit(0);
}

const runner = path.join(root, RUNNER_REL);
const result = spawnSync(
  process.execPath,
  [runner, 'session:start', 'scripts/hooks/session-start.js', 'minimal,standard,strict'],
  {
    input: raw,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, ESCC_PLUGIN_ROOT: root },
    cwd: process.cwd(),
    timeout: 30000,
  }
);

const stdout = typeof result.stdout === 'string' ? result.stdout : '';
process.stdout.write(stdout || raw);

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.error || result.status === null || result.signal) {
  const reason = result.error
    ? result.error.message
    : result.signal
      ? `signal ${result.signal}`
      : 'missing exit status';
  process.stderr.write(`[SessionStart] WARNING: session-start hook failed: ${reason}\n`);
  process.exit(0); // fail open — never block a session from starting
}

process.exit(Number.isInteger(result.status) ? result.status : 0);
