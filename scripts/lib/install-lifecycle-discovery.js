/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-lifecycle.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Discovery and doctor reporting for installed states: normalizing targets,
 * building per-adapter discovery records, reading install-state, classifying
 * issues by severity, analyzing drift/version mismatch/resolution drift, and
 * assembling the doctor report.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getInstallTargetAdapter,
  listInstallTargetAdapters,
} = require('./install-targets/registry');
const { readInstallState } = require('./install-state');
const { loadInstallManifests, resolveInstallPlan } = require('./install-manifests');

const {
  readPackageVersion,
  compareStringArrays,
} = require('./install-lifecycle-ops');
const {
  getManagedOperations,
  summarizeManagedOperationHealth,
} = require('./install-lifecycle-operations');

const DEFAULT_REPO_ROOT = path.join(__dirname, '../..');

function normalizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return listInstallTargetAdapters().map(adapter => adapter.target);
  }

  const normalizedTargets = [];
  for (const target of targets) {
    const adapter = getInstallTargetAdapter(target);
    if (!normalizedTargets.includes(adapter.target)) {
      normalizedTargets.push(adapter.target);
    }
  }

  return normalizedTargets;
}

function buildDiscoveryRecord(adapter, context) {
  const installTargetInput = {
    homeDir: context.homeDir,
    projectRoot: context.projectRoot,
    repoRoot: context.projectRoot,
  };
  const targetRoot = adapter.resolveRoot(installTargetInput);
  const installStatePath = adapter.getInstallStatePath(installTargetInput);
  const exists = fs.existsSync(installStatePath);

  if (!exists) {
    return {
      adapter: {
        id: adapter.id,
        target: adapter.target,
        kind: adapter.kind,
      },
      targetRoot,
      installStatePath,
      exists: false,
      state: null,
      error: null,
    };
  }

  try {
    const state = readInstallState(installStatePath);
    return {
      adapter: {
        id: adapter.id,
        target: adapter.target,
        kind: adapter.kind,
      },
      targetRoot,
      installStatePath,
      exists: true,
      state,
      error: null,
    };
  } catch (error) {
    return {
      adapter: {
        id: adapter.id,
        target: adapter.target,
        kind: adapter.kind,
      },
      targetRoot,
      installStatePath,
      exists: true,
      state: null,
      error: error.message,
    };
  }
}

function discoverInstalledStates(options = {}) {
  const context = {
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
  };
  const targets = normalizeTargets(options.targets);

  return targets.map(target => {
    const adapter = getInstallTargetAdapter(target);
    return buildDiscoveryRecord(adapter, context);
  });
}

function buildIssue(severity, code, message, extra = {}) {
  return {
    severity,
    code,
    message,
    ...extra,
  };
}

function determineStatus(issues) {
  if (issues.some(issue => issue.severity === 'error')) {
    return 'error';
  }

  if (issues.some(issue => issue.severity === 'warning')) {
    return 'warning';
  }

  return 'ok';
}

function analyzeRecord(record, context) {
  const issues = [];

  if (record.error) {
    issues.push(buildIssue('error', 'invalid-install-state', record.error));
    return {
      ...record,
      status: determineStatus(issues),
      issues,
    };
  }

  const state = record.state;
  if (!state) {
    return {
      ...record,
      status: 'missing',
      issues,
    };
  }

  if (!fs.existsSync(state.target.root)) {
    issues.push(buildIssue(
      'error',
      'missing-target-root',
      `Target root does not exist: ${state.target.root}`
    ));
  }

  if (state.target.root !== record.targetRoot) {
    issues.push(buildIssue(
      'warning',
      'target-root-mismatch',
      `Recorded target root differs from current target root (${record.targetRoot})`,
      {
        recordedTargetRoot: state.target.root,
        currentTargetRoot: record.targetRoot,
      }
    ));
  }

  if (state.target.installStatePath !== record.installStatePath) {
    issues.push(buildIssue(
      'warning',
      'install-state-path-mismatch',
      `Recorded install-state path differs from current path (${record.installStatePath})`,
      {
        recordedInstallStatePath: state.target.installStatePath,
        currentInstallStatePath: record.installStatePath,
      }
    ));
  }

  const managedOperations = getManagedOperations(state);
  const operationHealth = summarizeManagedOperationHealth(context.repoRoot, managedOperations);
  const missingManagedOperations = operationHealth.missing;

  if (missingManagedOperations.length > 0) {
    issues.push(buildIssue(
      'error',
      'missing-managed-files',
      `${missingManagedOperations.length} managed file(s) are missing`,
      {
        paths: missingManagedOperations.map(entry => entry.destinationPath),
      }
    ));
  }

  if (operationHealth.drifted.length > 0) {
    issues.push(buildIssue(
      'warning',
      'drifted-managed-files',
      `${operationHealth.drifted.length} managed file(s) differ from the source repo`,
      {
        paths: operationHealth.drifted.map(entry => entry.destinationPath),
      }
    ));
  }

  if (operationHealth.missingSource.length > 0) {
    issues.push(buildIssue(
      'error',
      'missing-source-files',
      `${operationHealth.missingSource.length} source file(s) referenced by install-state are missing`,
      {
        paths: operationHealth.missingSource.map(entry => entry.sourcePath).filter(Boolean),
      }
    ));
  }

  if (operationHealth.unverified.length > 0) {
    issues.push(buildIssue(
      'warning',
      'unverified-managed-operations',
      `${operationHealth.unverified.length} managed operation(s) could not be content-verified`,
      {
        paths: operationHealth.unverified.map(entry => entry.destinationPath).filter(Boolean),
      }
    ));
  }

  if (state.source.manifestVersion !== context.manifestVersion) {
    issues.push(buildIssue(
      'warning',
      'manifest-version-mismatch',
      `Recorded manifest version ${state.source.manifestVersion} differs from current manifest version ${context.manifestVersion}`
    ));
  }

  if (
    context.packageVersion
    && state.source.repoVersion
    && state.source.repoVersion !== context.packageVersion
  ) {
    issues.push(buildIssue(
      'warning',
      'repo-version-mismatch',
      `Recorded repo version ${state.source.repoVersion} differs from current repo version ${context.packageVersion}`
    ));
  }

  if (!state.request.legacyMode) {
    try {
      const desiredPlan = resolveInstallPlan({
        repoRoot: context.repoRoot,
        projectRoot: context.projectRoot,
        homeDir: context.homeDir,
        target: record.adapter.target,
        profileId: state.request.profile || null,
        moduleIds: state.request.modules || [],
        includeComponentIds: state.request.includeComponents || [],
        excludeComponentIds: state.request.excludeComponents || [],
      });

      if (
        !compareStringArrays(desiredPlan.selectedModuleIds, state.resolution.selectedModules)
        || !compareStringArrays(desiredPlan.skippedModuleIds, state.resolution.skippedModules)
      ) {
        issues.push(buildIssue(
          'warning',
          'resolution-drift',
          'Current manifest resolution differs from recorded install-state',
          {
            expectedSelectedModules: desiredPlan.selectedModuleIds,
            recordedSelectedModules: state.resolution.selectedModules,
            expectedSkippedModules: desiredPlan.skippedModuleIds,
            recordedSkippedModules: state.resolution.skippedModules,
          }
        ));
      }
    } catch (error) {
      issues.push(buildIssue(
        'error',
        'resolution-unavailable',
        error.message
      ));
    }
  }

  return {
    ...record,
    status: determineStatus(issues),
    issues,
  };
}

function buildDoctorReport(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const manifests = loadInstallManifests({ repoRoot });
  const records = discoverInstalledStates({
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets,
  }).filter(record => record.exists);
  const context = {
    repoRoot,
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
    manifestVersion: manifests.modulesVersion,
    packageVersion: readPackageVersion(repoRoot),
  };
  const results = records.map(record => analyzeRecord(record, context));
  const summary = results.reduce((accumulator, result) => {
    const errorCount = result.issues.filter(issue => issue.severity === 'error').length;
    const warningCount = result.issues.filter(issue => issue.severity === 'warning').length;

    return {
      checkedCount: accumulator.checkedCount + 1,
      okCount: accumulator.okCount + (result.status === 'ok' ? 1 : 0),
      errorCount: accumulator.errorCount + errorCount,
      warningCount: accumulator.warningCount + warningCount,
    };
  }, {
    checkedCount: 0,
    okCount: 0,
    errorCount: 0,
    warningCount: 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    packageVersion: context.packageVersion,
    manifestVersion: context.manifestVersion,
    results,
    summary,
  };
}

module.exports = {
  DEFAULT_REPO_ROOT,
  normalizeTargets,
  buildDiscoveryRecord,
  discoverInstalledStates,
  buildIssue,
  determineStatus,
  analyzeRecord,
  buildDoctorReport,
};
