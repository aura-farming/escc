#!/usr/bin/env node
'use strict';

/*
 * ESCC installer — plan-then-apply over the ESCC install-* libs.
 *
 * Installer concept adapted from Everything Claude Code (ECC) by Affaan Mustafa
 * (https://github.com/affaan-m/ECC, MIT). ECC spreads install/auto-update across
 * several scripts; ESCC composes a single plan+apply entrypoint over the ported,
 * re-namespaced install-executor / install-manifests libs (ECC_* -> ESCC_*).
 *
 * Thin, uniform-contract ({code,text,data}) wrapper so scripts/escc.js can mount
 * `install` / `plan` without re-implementing resolution. The heavy lifting
 * (manifest resolution, escc-namespaced operations, idempotent apply, install-
 * state receipt) lives in the already-tested install-executor / install-manifests
 * / install/apply libs.
 */

const path = require('path');

const {
  createManifestInstallPlan,
  applyInstallPlan,
  SUPPORTED_INSTALL_TARGETS,
} = require('./lib/install-executor');
const { resolveAgentDataHome } = require('./lib/agent-data-home');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_TARGET = 'claude';
// Default install = everything (spec §6.7: "Default path = ... everything").
const DEFAULT_PROFILE = 'full';

/** Normalize caller options into the createManifestInstallPlan arg shape. */
function planArgs(opts = {}) {
  return {
    sourceRoot: opts.sourceRoot || REPO_ROOT,
    homeDir: opts.homeDir || resolveAgentDataHome(),
    target: opts.target || DEFAULT_TARGET,
    profileId: opts.profileId || DEFAULT_PROFILE,
  };
}

function isSupportedTarget(target) {
  return Array.isArray(SUPPORTED_INSTALL_TARGETS) && SUPPORTED_INSTALL_TARGETS.includes(target);
}

function refuseTarget(target) {
  const supported = (SUPPORTED_INSTALL_TARGETS || []).join(', ');
  return { code: 1, text: `Refused: unsupported install target '${target}'. Supported targets: ${supported}.`, data: null };
}

function summarizePlan(plan, args) {
  return [
    `target:      ${args.target}  ->  ${plan.targetRoot}`,
    `profile:     ${args.profileId}`,
    `modules:     ${(plan.selectedModuleIds || []).join(', ') || '(none)'}`,
    `operations:  ${(plan.operations || []).length}`,
    `state file:  ${plan.installStatePath}`,
  ].join('\n');
}

/**
 * Resolve a plan without touching disk (dry-run).
 * @param {{sourceRoot?:string, homeDir?:string, target?:string, profileId?:string}} [opts]
 * @returns {{code:number, text:string, data:*}}
 */
function runPlan(opts = {}) {
  const args = planArgs(opts);
  if (!isSupportedTarget(args.target)) return refuseTarget(args.target);
  try {
    const plan = createManifestInstallPlan(args);
    return { code: 0, text: `DRY RUN — no changes written.\n${summarizePlan(plan, args)}`, data: { plan } };
  } catch (err) {
    return { code: 1, text: `Plan failed: ${err.message}`, data: null };
  }
}

/**
 * Resolve + apply the plan (unless dryRun, which delegates to runPlan).
 * @param {{...planArgs, dryRun?:boolean}} [opts]
 * @returns {{code:number, text:string, data:*}}
 */
function runInstall(opts = {}) {
  if (opts.dryRun) return runPlan(opts);
  const args = planArgs(opts);
  if (!isSupportedTarget(args.target)) return refuseTarget(args.target);
  try {
    const plan = createManifestInstallPlan(args);
    const result = applyInstallPlan(plan);
    return { code: 0, text: `Installed.\n${summarizePlan(plan, args)}`, data: { plan, result } };
  } catch (err) {
    return { code: 1, text: `Install failed: ${err.message}`, data: null };
  }
}

const INSTALL_VALUE_FLAGS = { '--target': 'target', '--profile': 'profileId', '--home': 'homeDir', '--repo-root': 'sourceRoot' };

/** Parse the installer CLI flag set. A value flag with no argument is an error. */
function parseArgs(argv = []) {
  const opts = {};
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (INSTALL_VALUE_FLAGS[a]) {
      const value = argv[i + 1];
      if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
        errors.push(`Flag ${a} requires a value`);
      } else {
        opts[INSTALL_VALUE_FLAGS[a]] = value;
        i += 1;
      }
    }
  }
  if (errors.length) opts._errors = errors;
  return opts;
}

/** CLI entry: install (honoring --dry-run). @returns {{code,text,data}} */
function run(argv = []) {
  const opts = parseArgs(argv);
  if (opts._errors) return { code: 1, text: `${opts._errors.join('; ')}.`, data: null };
  return runInstall(opts);
}

module.exports = {
  runPlan,
  runInstall,
  parseArgs,
  run,
  planArgs,
  REPO_ROOT,
  DEFAULT_TARGET,
  DEFAULT_PROFILE,
};

if (require.main === module) {
  const res = run(process.argv.slice(2));
  process.stdout.write(`${res.text}\n`);
  process.exit(res.code);
}
