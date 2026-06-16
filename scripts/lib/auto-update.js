'use strict';

/*
 * ESCC auto-update — `escc auto-update` (spec §6.6: "git pull + reapply").
 *
 * Adapted from ECC's scripts/auto-update.js (MIT, (c) Affaan Mustafa,
 * https://github.com/affaan-m/ECC). ECC shells out to scripts/install-apply.js
 * per target; ESCC reapplies IN-PROCESS via the already-tested
 * repairInstalledStates (which rebuilds each target's plan from its recorded
 * install-state request against the freshly-pulled source), so there is no
 * subprocess install step. The git step is injectable (`exec`) so it is
 * hermetically testable and so --dry-run never touches the working tree.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { discoverInstalledStates, repairInstalledStates } = require('./install-lifecycle');

// scripts/lib/ -> repo root
const REPO_ROOT = path.join(__dirname, '..', '..');

/** Default command runner: throws on spawn error or non-zero exit. */
function defaultExec(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    const out = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${out ? `: ${out}` : ''}`);
  }
  return result;
}

function noOp(repoRoot, dryRun) {
  return {
    code: 0,
    text: 'auto-update: no ESCC install-state found for this context — nothing to update.',
    data: { pulled: false, dryRun, repoRoot, targets: [], repaired: null },
  };
}

/**
 * Pull the latest source and reapply every managed target from its recorded
 * install-state request.
 * @param {{repoRoot?:string, homeDir?:string, targets?:string[], dryRun?:boolean, exec?:Function}} [args]
 * @returns {{code:number, text:string, data:object}}
 */
function runAutoUpdate(args = {}) {
  const repoRoot = args.repoRoot || REPO_ROOT;
  const homeDir = args.homeDir;
  const dryRun = !!args.dryRun;
  const exec = typeof args.exec === 'function' ? args.exec : defaultExec;

  // Which targets are actually installed in this context?
  let records;
  try {
    records = discoverInstalledStates({ homeDir, targets: args.targets }).filter(r => r.exists);
  } catch (err) {
    return { code: 1, text: `auto-update failed during discovery: ${err.message}`, data: null };
  }
  if (!records.length) return noOp(repoRoot, dryRun);

  const targets = [...new Set(records.map(r => r.adapter && r.adapter.target).filter(Boolean))];

  if (dryRun) {
    return {
      code: 0,
      text: `auto-update DRY RUN — would run: git -C ${repoRoot} pull --ff-only; then reapply target(s): ${targets.join(', ')}.`,
      data: { pulled: false, dryRun: true, repoRoot, targets, repaired: null },
    };
  }

  // 1) Pull latest source. A failed pull aborts BEFORE any reapply.
  try {
    exec('git', ['fetch', '--all', '--prune'], { cwd: repoRoot });
    exec('git', ['pull', '--ff-only'], { cwd: repoRoot });
  } catch (err) {
    return {
      code: 1,
      text: `auto-update: git pull failed (no changes reapplied): ${err.message}`,
      data: { pulled: false, dryRun: false, repoRoot, targets, repaired: null },
    };
  }

  // 2) Reapply each managed target from its recorded request against the new source.
  let repaired;
  try {
    repaired = repairInstalledStates({ repoRoot, homeDir, targets });
  } catch (err) {
    return {
      code: 1,
      text: `auto-update: pulled latest, but reapply failed: ${err.message}`,
      data: { pulled: true, dryRun: false, repoRoot, targets, repaired: null },
    };
  }

  return {
    code: 0,
    text: `auto-update: pulled latest + reapplied ${targets.length} target(s): ${targets.join(', ')}.`,
    data: { pulled: true, dryRun: false, repoRoot, targets, repaired },
  };
}

module.exports = { runAutoUpdate, defaultExec, REPO_ROOT };
