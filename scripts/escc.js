#!/usr/bin/env node
'use strict';

/*
 * escc — the ESCC operator CLI dispatcher (spec §6.6 + §A.6).
 *
 * NEW for ESCC: a single entrypoint consolidating capabilities ECC spreads
 * across many scripts/*.js (auto-update, catalog, session-inspect, ...). Every
 * subcommand returns the uniform { code, text, data } contract, so handlers are
 * directly testable and the instinct slash-command handlers mount unchanged.
 *
 * 12 subcommands: install · plan · catalog · doctor · repair · status ·
 * sessions · list-installed · uninstall · auto-update · privacy-purge · watch
 * plus the mounted instinct handlers (instinct-status / instinct-promote /
 * evolve) from scripts/instincts/instinct-cli.js.
 *
 * The dispatcher delegates to already-tested libs; it never re-implements their
 * logic. Heavy/destructive work (install apply, privacy erasure, git pull) is
 * gated by the libs themselves (dry-run defaults, --confirm, injectable git).
 */

const fs = require('fs');

const installer = require('./install');
const manifests = require('./lib/install-manifests');
const lifecycle = require('./lib/install-lifecycle');
const purgeLib = require('./lib/privacy-purge');
const watchLib = require('./lib/trigger-watch');
const autoUpdateLib = require('./lib/auto-update');
const sessionMgr = require('./lib/session-manager');
const instinctCli = require('./instincts/instinct-cli');
const instinctStore = require('./instincts/instinct-store');

const HELP = `escc — EverythingSales Claude Code operator CLI

Usage: escc <command> [options]

Install / lifecycle:
  install         resolve a plan and apply it (--target --profile --home --repo-root [--dry-run])
  plan            dry-run resolution only (writes nothing)
  catalog         list install profiles / modules / components (--repo-root)
  doctor          check installed targets for drift vs install-state (--exit-code)
  repair          restore drifted/missing managed files from source
  status          harness + install + workspace summary (--markdown --write <path> --exit-code)
  sessions        list recent saved sessions (--limit <n>)
  list-installed  list managed targets discovered in this context
  uninstall       remove managed files + install-state for the target
  auto-update     git pull + reapply each managed target (--dry-run)

Workspace / data:
  privacy-purge <identifier>  erase a subject across local stores (DRY-RUN unless --confirm / --yes)
  watch                       one read-only signal sweep (overdue promises + closing deals) -> notify

Instinct engine (mounted from instinct-cli):
  instinct-status         list instincts + the review gate (--approve <id> / --reject <id>)
  instinct-promote <id>   manager-gated personal -> team promotion (--role <role>)
  evolve                  graduate high-confidence domains into evolved-skill drafts

  help            show this message`;

const VALUE_FLAGS = new Set([
  '--target', '--profile', '--home', '--repo-root', '--write',
  '--limit', '--days', '--within-days', '--role', '--scope', '--approve', '--reject',
]);

/** `--repo-root` -> `repoRoot`, `--within-days` -> `withinDays`. */
function camel(flag) {
  return flag.replace(/^--/, '').split('-')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** Parse the tail args into { flags, positional }. */
function parseArgs(rest = []) {
  const flags = {};
  const positional = [];
  const errors = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--markdown') flags.markdown = true;
    else if (a === '--exit-code') flags.exitCode = true;
    else if (a === '--confirm' || a === '--yes') flags.confirm = true;
    else if (VALUE_FLAGS.has(a)) {
      const value = rest[i + 1];
      if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
        errors.push(`Flag ${a} requires a value`);
      } else {
        flags[camel(a)] = value;
        i += 1;
      }
    } else if (a.startsWith('--')) flags[camel(a)] = true; // tolerate unknown boolean flags
    else positional.push(a);
  }
  return { flags, positional, errors };
}

function idsOf(list) {
  if (Array.isArray(list)) {
    return list.map(x => (x && typeof x === 'object' ? (x.id || x.name || JSON.stringify(x)) : String(x)));
  }
  if (list && typeof list === 'object') return Object.keys(list);
  return [];
}

function toInstallOpts(flags) {
  return { sourceRoot: flags.repoRoot, homeDir: flags.home, target: flags.target, profileId: flags.profile, dryRun: flags.dryRun };
}

function toLifecycleOpts(flags) {
  return { repoRoot: flags.repoRoot, homeDir: flags.home, targets: flags.target ? [flags.target] : undefined };
}

// --- handlers ---------------------------------------------------------------

function handleHelp() {
  return { code: 0, text: HELP, data: null };
}

function handleCatalog(flags) {
  try {
    const profiles = manifests.listInstallProfiles({ repoRoot: flags.repoRoot });
    const modules = manifests.listInstallModules({ repoRoot: flags.repoRoot });
    const components = manifests.listInstallComponents({ repoRoot: flags.repoRoot });
    const text = [
      `Profiles (${idsOf(profiles).length}):   ${idsOf(profiles).join(', ') || '(none)'}`,
      `Modules (${idsOf(modules).length}):    ${idsOf(modules).join(', ') || '(none)'}`,
      `Components (${idsOf(components).length}): ${idsOf(components).join(', ') || '(none)'}`,
    ].join('\n');
    return { code: 0, text, data: { profiles, modules, components } };
  } catch (err) {
    return { code: 1, text: `catalog failed: ${err.message} (manifests land in Phase 4)`, data: null };
  }
}

function formatDoctor(report) {
  const s = report.summary || {};
  const lines = [`Doctor: ${s.okCount || 0} ok, ${s.errorCount || 0} error(s) across ${(report.results || []).length} target(s).`];
  for (const r of report.results || []) lines.push(`- ${r.adapter ? r.adapter.id : '?'}: ${r.status}`);
  return lines.join('\n');
}

function handleDoctor(flags) {
  try {
    const report = lifecycle.buildDoctorReport(toLifecycleOpts(flags));
    const errors = (report.summary && report.summary.errorCount) || 0;
    return { code: flags.exitCode && errors > 0 ? 1 : 0, text: formatDoctor(report), data: report };
  } catch (err) {
    return { code: 1, text: `doctor failed: ${err.message}`, data: null };
  }
}

function handleRepair(flags) {
  try {
    const r = lifecycle.repairInstalledStates(toLifecycleOpts(flags));
    return { code: 0, text: `Repaired ${(r.summary && r.summary.repairedCount) || 0} item(s).`, data: r };
  } catch (err) {
    return { code: 1, text: `repair failed: ${err.message}`, data: null };
  }
}

function handleListInstalled(flags) {
  try {
    const records = lifecycle.discoverInstalledStates(toLifecycleOpts(flags)).filter(r => r.exists);
    if (!records.length) return { code: 0, text: 'No ESCC install-state found for this context.', data: { records: [] } };
    const lines = records.map(r => `- ${r.adapter.id} (${r.adapter.target}) — ${r.installStatePath}`);
    return { code: 0, text: `Installed targets (${records.length}):\n${lines.join('\n')}`, data: { records } };
  } catch (err) {
    return { code: 1, text: `list-installed failed: ${err.message}`, data: null };
  }
}

function handleUninstall(flags) {
  try {
    const r = lifecycle.uninstallInstalledStates(toLifecycleOpts(flags));
    return { code: 0, text: `Uninstalled ${(r.summary && r.summary.uninstalledCount) || 0} target(s).`, data: r };
  } catch (err) {
    return { code: 1, text: `uninstall failed: ${err.message}`, data: null };
  }
}

function handleSessions(flags) {
  try {
    const n = flags.limit ? Number(flags.limit) : 10;
    const recent = sessionMgr.listRecentSessions(Number.isFinite(n) ? n : 10);
    if (!recent.length) return { code: 0, text: 'No saved sessions found.', data: { sessions: [] } };
    const lines = recent.map(s => `- ${s.title || s.id || s.filename || '(session)'}${s.date ? ` (${s.date})` : ''}`);
    return { code: 0, text: `Recent sessions (${recent.length}):\n${lines.join('\n')}`, data: { sessions: recent } };
  } catch (err) {
    return { code: 1, text: `sessions failed: ${err.message}`, data: null };
  }
}

/** Compose a fail-soft operator HUD from install + instinct + signal + session state. */
function handleStatus(flags) {
  const data = {};
  const sections = [];

  try {
    const report = lifecycle.buildDoctorReport(toLifecycleOpts(flags));
    data.install = report.summary;
    sections.push(`Install: ${report.summary.okCount} ok, ${report.summary.errorCount} error(s)`);
  } catch (_err) {
    sections.push('Install: (no install-state in this context)');
  }
  try {
    const personal = instinctStore.readInstincts('personal').length;
    const team = instinctStore.readInstincts('team').length;
    data.instincts = { personal, team, workspace: instinctStore.workspaceId() };
    sections.push(`Instincts: ${personal} personal, ${team} team (workspace ${data.instincts.workspace})`);
  } catch (_err) {
    sections.push('Instincts: (unavailable)');
  }
  try {
    const digest = watchLib.sweep({ withinDays: flags.withinDays ? Number(flags.withinDays) : undefined });
    data.signals = { overdue: digest.overduePromises.length, nearClose: digest.nearCloseDeals.length };
    sections.push(`Signals: ${data.signals.overdue} overdue promise(s), ${data.signals.nearClose} deal(s) closing soon`);
  } catch (_err) {
    sections.push('Signals: (unavailable)');
  }
  try {
    const recent = sessionMgr.listRecentSessions(flags.limit ? Number(flags.limit) : 5);
    data.sessions = recent.length;
    sections.push(`Recent sessions: ${recent.length}`);
  } catch (_err) {
    sections.push('Recent sessions: (unavailable)');
  }

  const text = flags.markdown
    ? `# ESCC status\n\n${sections.map(s => `- ${s}`).join('\n')}\n`
    : `ESCC status:\n${sections.map(s => `  ${s}`).join('\n')}`;
  let writeError = null;
  if (flags.write) {
    try { fs.writeFileSync(flags.write, text.endsWith('\n') ? text : `${text}\n`); } catch (err) { writeError = err.message; }
  }
  data.writeError = writeError;
  const code = flags.exitCode && data.install && data.install.errorCount > 0 ? 1 : 0;
  const out = writeError ? `${text}\n(warning: could not write to ${flags.write}: ${writeError})` : text;
  return { code, text: out, data };
}

// --- dispatch ---------------------------------------------------------------

/** Route an argv vector to a handler. @returns {{code:number, text:string, data:*}} */
function run(argv = []) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') return handleHelp();

  // Instinct mounts: forward the raw tail so instinct-cli's own flag parser applies.
  if (command === 'instinct-status') return instinctCli.run(['status', ...rest]);
  if (command === 'instinct-promote') return instinctCli.run(['promote', ...rest]);
  if (command === 'evolve') return instinctCli.run(['evolve', ...rest]);

  const { flags, positional, errors } = parseArgs(rest);
  if (errors.length) return { code: 1, text: `${errors.join('; ')}. Run 'escc help' for usage.`, data: null };
  switch (command) {
    case 'install': return installer.runInstall(toInstallOpts(flags));
    case 'plan': return installer.runPlan(toInstallOpts(flags));
    case 'catalog': return handleCatalog(flags);
    case 'doctor': return handleDoctor(flags);
    case 'repair': return handleRepair(flags);
    case 'status': return handleStatus(flags);
    case 'sessions': return handleSessions(flags);
    case 'list-installed': return handleListInstalled(flags);
    case 'uninstall': return handleUninstall(flags);
    case 'auto-update': return autoUpdateLib.runAutoUpdate({ repoRoot: flags.repoRoot, homeDir: flags.home, targets: flags.target ? [flags.target] : undefined, dryRun: flags.dryRun });
    case 'privacy-purge': return purgeLib.runPurge({ identifier: positional[0], confirm: flags.confirm });
    case 'watch': return watchLib.runWatch({ withinDays: flags.withinDays ? Number(flags.withinDays) : undefined });
    default: return { code: 1, text: `Unknown command: ${command}. Run 'escc help' for usage.`, data: null };
  }
}

module.exports = { run, parseArgs, camel, idsOf, HELP };

if (require.main === module) {
  const res = run(process.argv.slice(2));
  if (res && typeof res.text === 'string' && res.text) process.stdout.write(`${res.text}\n`);
  process.exit(res ? res.code : 0);
}
