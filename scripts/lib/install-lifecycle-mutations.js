/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-lifecycle.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * State-mutating install lifecycle entry points: building a repair plan from a
 * recorded install-state (recorded/legacy replay or fresh manifest plan),
 * repairing missing/drifted managed files, and uninstalling managed operations
 * with restore precedence and bounded empty-parent cleanup.
 */

'use strict';

const os = require('os');
const fs = require('fs');

const { writeInstallState } = require('./install-state');
const { loadInstallManifests } = require('./install-manifests');
const { createManifestInstallPlan } = require('./install-executor');

const {
  readPackageVersion,
  cleanupEmptyParentDirs,
} = require('./install-lifecycle-ops');
const {
  getManagedOperations,
  hydrateRecordedOperations,
  buildRecordedStatePreview,
  shouldRepairFromRecordedOperations,
  executeRepairOperation,
  executeUninstallOperation,
  summarizeManagedOperationHealth,
} = require('./install-lifecycle-operations');
const {
  DEFAULT_REPO_ROOT,
  discoverInstalledStates,
} = require('./install-lifecycle-discovery');

function createRepairPlanFromRecord(record, context) {
  const state = record.state;
  if (!state) {
    throw new Error('No install-state available for repair');
  }

  if (state.request.legacyMode || shouldRepairFromRecordedOperations(state)) {
    const operations = hydrateRecordedOperations(context.repoRoot, getManagedOperations(state));
    const statePreview = buildRecordedStatePreview(state, context, operations);

    return {
      mode: state.request.legacyMode ? 'legacy' : 'recorded',
      target: record.adapter.target,
      adapter: record.adapter,
      targetRoot: state.target.root,
      installRoot: state.target.root,
      installStatePath: state.target.installStatePath,
      warnings: [],
      languages: Array.isArray(state.request.legacyLanguages)
        ? [...state.request.legacyLanguages]
        : [],
      operations,
      statePreview,
    };
  }

  const desiredPlan = createManifestInstallPlan({
    sourceRoot: context.repoRoot,
    target: record.adapter.target,
    profileId: state.request.profile || null,
    moduleIds: state.request.modules || [],
    includeComponentIds: state.request.includeComponents || [],
    excludeComponentIds: state.request.excludeComponents || [],
    projectRoot: context.projectRoot,
    homeDir: context.homeDir,
  });

  return {
    ...desiredPlan,
    statePreview: {
      ...desiredPlan.statePreview,
      installedAt: state.installedAt,
      lastValidatedAt: new Date().toISOString(),
    },
  };
}

function repairInstalledStates(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const manifests = loadInstallManifests({ repoRoot });
  const context = {
    repoRoot,
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
    projectRoot: options.projectRoot || process.cwd(),
    manifestVersion: manifests.modulesVersion,
    packageVersion: readPackageVersion(repoRoot),
  };
  const records = discoverInstalledStates({
    homeDir: context.homeDir,
    projectRoot: context.projectRoot,
    targets: options.targets,
  }).filter(record => record.exists);

  const results = records.map(record => {
    if (record.error) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        repairedPaths: [],
        plannedRepairs: [],
        error: record.error,
      };
    }

    try {
      const desiredPlan = createRepairPlanFromRecord(record, context);
      const operationHealth = summarizeManagedOperationHealth(context.repoRoot, desiredPlan.operations);

      if (operationHealth.missingSource.length > 0) {
        return {
          adapter: record.adapter,
          status: 'error',
          installStatePath: record.installStatePath,
          repairedPaths: [],
          plannedRepairs: [],
          error: `Missing source file(s): ${operationHealth.missingSource.map(entry => entry.sourcePath).join(', ')}`,
        };
      }

      const repairOperations = [
        ...operationHealth.missing.map(entry => ({ ...entry.operation })),
        ...operationHealth.drifted.map(entry => ({ ...entry.operation })),
      ];
      const plannedRepairs = repairOperations.map(operation => operation.destinationPath);

      if (options.dryRun) {
        return {
          adapter: record.adapter,
          status: plannedRepairs.length > 0 ? 'planned' : 'ok',
          installStatePath: record.installStatePath,
          repairedPaths: [],
          plannedRepairs,
          stateRefreshed: plannedRepairs.length === 0,
          error: null,
        };
      }

      if (repairOperations.length > 0) {
        for (const operation of repairOperations) {
          executeRepairOperation(context.repoRoot, operation);
        }
        writeInstallState(desiredPlan.installStatePath, desiredPlan.statePreview);
      } else {
        writeInstallState(desiredPlan.installStatePath, desiredPlan.statePreview);
      }

      return {
        adapter: record.adapter,
        status: repairOperations.length > 0 ? 'repaired' : 'ok',
        installStatePath: record.installStatePath,
        repairedPaths: plannedRepairs,
        plannedRepairs: [],
        stateRefreshed: true,
        error: null,
      };
    } catch (error) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        repairedPaths: [],
        plannedRepairs: [],
        error: error.message,
      };
    }
  });

  const summary = results.reduce((accumulator, result) => ({
    checkedCount: accumulator.checkedCount + 1,
    repairedCount: accumulator.repairedCount + (result.status === 'repaired' ? 1 : 0),
    plannedRepairCount: accumulator.plannedRepairCount + (result.status === 'planned' ? 1 : 0),
    errorCount: accumulator.errorCount + (result.status === 'error' ? 1 : 0),
  }), {
    checkedCount: 0,
    repairedCount: 0,
    plannedRepairCount: 0,
    errorCount: 0,
  });

  return {
    dryRun: Boolean(options.dryRun),
    generatedAt: new Date().toISOString(),
    results,
    summary,
  };
}

function uninstallInstalledStates(options = {}) {
  const records = discoverInstalledStates({
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets,
  }).filter(record => record.exists);

  const results = records.map(record => {
    if (record.error || !record.state) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        removedPaths: [],
        plannedRemovals: [],
        error: record.error || 'No valid install-state available',
      };
    }

    const state = record.state;
    const plannedRemovals = Array.from(new Set([
      ...getManagedOperations(state).map(operation => operation.destinationPath),
      state.target.installStatePath,
    ]));

    if (options.dryRun) {
      return {
        adapter: record.adapter,
        status: 'planned',
        installStatePath: record.installStatePath,
        removedPaths: [],
        plannedRemovals,
        error: null,
      };
    }

    try {
      const removedPaths = [];
      const cleanupTargets = [];
      const operations = getManagedOperations(state);

      for (const operation of operations) {
        const outcome = executeUninstallOperation(operation);
        removedPaths.push(...outcome.removedPaths);
        cleanupTargets.push(...outcome.cleanupTargets);
      }

      if (fs.existsSync(state.target.installStatePath)) {
        fs.rmSync(state.target.installStatePath, { force: true });
        removedPaths.push(state.target.installStatePath);
        cleanupTargets.push(state.target.installStatePath);
      }

      for (const cleanupTarget of cleanupTargets) {
        cleanupEmptyParentDirs(cleanupTarget, state.target.root);
      }

      return {
        adapter: record.adapter,
        status: 'uninstalled',
        installStatePath: record.installStatePath,
        removedPaths,
        plannedRemovals: [],
        error: null,
      };
    } catch (error) {
      return {
        adapter: record.adapter,
        status: 'error',
        installStatePath: record.installStatePath,
        removedPaths: [],
        plannedRemovals,
        error: error.message,
      };
    }
  });

  const summary = results.reduce((accumulator, result) => ({
    checkedCount: accumulator.checkedCount + 1,
    uninstalledCount: accumulator.uninstalledCount + (result.status === 'uninstalled' ? 1 : 0),
    plannedRemovalCount: accumulator.plannedRemovalCount + (result.status === 'planned' ? 1 : 0),
    errorCount: accumulator.errorCount + (result.status === 'error' ? 1 : 0),
  }), {
    checkedCount: 0,
    uninstalledCount: 0,
    plannedRemovalCount: 0,
    errorCount: 0,
  });

  return {
    dryRun: Boolean(options.dryRun),
    generatedAt: new Date().toISOString(),
    results,
    summary,
  };
}

module.exports = {
  createRepairPlanFromRecord,
  repairInstalledStates,
  uninstallInstalledStates,
};
