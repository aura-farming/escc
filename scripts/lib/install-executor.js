/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-executor.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Manifest-driven install planner. Resolves a manifest install plan into
 * concrete file operations (copy-file / merge-json), previews the resulting
 * install state, and applies the plan via ./install/apply. ESCC supports only
 * the 'claude' and 'claude-project' targets — the ECC legacy/language and
 * cursor/antigravity install paths are intentionally dropped.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  SUPPORTED_INSTALL_TARGETS,
  resolveInstallPlan,
} = require('./install-manifests');
const { getInstallTargetAdapter } = require('./install-targets/registry');

const CLAUDE_ESCC_NAMESPACE = 'escc';
const EXCLUDED_GENERATED_SOURCE_SUFFIXES = [
  '/escc-install-state.json',
  '/escc/install-state.json',
];

const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
]);

function getSourceRoot() {
  return path.join(__dirname, '../..');
}

function getPackageVersion(sourceRoot) {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')
    );
    return packageJson.version || null;
  } catch (_error) {
    return null;
  }
}

function getManifestVersion(sourceRoot) {
  try {
    const modulesManifest = JSON.parse(
      fs.readFileSync(path.join(sourceRoot, 'manifests', 'install-modules.json'), 'utf8')
    );
    return modulesManifest.version || 1;
  } catch (_error) {
    return 1;
  }
}

function getRepoCommit(sourceRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sourceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch (_error) {
    return null;
  }
}

function listFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      const childFiles = listFilesRecursive(absolutePath);
      for (const childFile of childFiles) {
        files.push(path.join(entry.name, childFile));
      }
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }

  return files.sort();
}

function isGeneratedRuntimeSourcePath(sourceRelativePath) {
  const normalizedPath = String(sourceRelativePath || '').replace(/\\/g, '/');
  return EXCLUDED_GENERATED_SOURCE_SUFFIXES.some(suffix => normalizedPath.endsWith(suffix));
}

function createStatePreview(options) {
  const { createInstallState } = require('./install-state');
  return createInstallState(options);
}

function applyInstallPlan(plan) {
  const { applyInstallPlan: applyPlan } = require('./install/apply');
  return applyPlan(plan);
}

function buildCopyFileOperation({ moduleId, sourcePath, sourceRelativePath, destinationPath, strategy }) {
  return {
    kind: 'copy-file',
    moduleId,
    sourcePath,
    sourceRelativePath,
    destinationPath,
    strategy,
    ownership: 'managed',
    scaffoldOnly: false,
  };
}

function addRecursiveCopyOperations(operations, options) {
  const sourceDir = path.join(options.sourceRoot, options.sourceRelativeDir);
  if (!fs.existsSync(sourceDir)) {
    return 0;
  }

  const relativeFiles = listFilesRecursive(sourceDir);

  for (const relativeFile of relativeFiles) {
    const sourceRelativePath = path.join(options.sourceRelativeDir, relativeFile);
    const sourcePath = path.join(options.sourceRoot, sourceRelativePath);
    const destinationRelativePath = typeof options.destinationRelativePathTransform === 'function'
      ? options.destinationRelativePathTransform(relativeFile, sourceRelativePath)
      : relativeFile;
    if (!destinationRelativePath) {
      continue;
    }
    const destinationPath = path.join(options.destinationDir, destinationRelativePath);
    operations.push(buildCopyFileOperation({
      moduleId: options.moduleId,
      sourcePath,
      sourceRelativePath,
      destinationPath,
      strategy: options.strategy || 'preserve-relative-path',
    }));
  }

  return relativeFiles.length;
}

function addFileCopyOperation(operations, options) {
  const sourcePath = path.join(options.sourceRoot, options.sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  operations.push(buildCopyFileOperation({
    moduleId: options.moduleId,
    sourcePath,
    sourceRelativePath: options.sourceRelativePath,
    destinationPath: options.destinationPath,
    strategy: options.strategy || 'preserve-relative-path',
  }));

  return true;
}

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function addJsonMergeOperation(operations, options) {
  const sourcePath = path.join(options.sourceRoot, options.sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  operations.push({
    kind: 'merge-json',
    moduleId: options.moduleId,
    sourceRelativePath: options.sourceRelativePath,
    destinationPath: options.destinationPath,
    strategy: 'merge-json',
    ownership: 'managed',
    scaffoldOnly: false,
    mergePayload: readJsonObject(sourcePath, options.sourceRelativePath),
  });

  return true;
}

function materializeScaffoldOperation(sourceRoot, operation) {
  if (operation.kind === 'merge-json') {
    return [{
      kind: 'merge-json',
      moduleId: operation.moduleId,
      sourceRelativePath: operation.sourceRelativePath,
      destinationPath: operation.destinationPath,
      strategy: operation.strategy || 'merge-json',
      ownership: operation.ownership || 'managed',
      scaffoldOnly: Object.hasOwn(operation, 'scaffoldOnly') ? operation.scaffoldOnly : false,
      mergePayload: readJsonObject(
        path.join(sourceRoot, operation.sourceRelativePath),
        operation.sourceRelativePath
      ),
    }];
  }

  const sourcePath = path.join(sourceRoot, operation.sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    return [];
  }

  if (isGeneratedRuntimeSourcePath(operation.sourceRelativePath)) {
    return [];
  }

  const stat = fs.statSync(sourcePath);
  if (stat.isFile()) {
    return [buildCopyFileOperation({
      moduleId: operation.moduleId,
      sourcePath,
      sourceRelativePath: operation.sourceRelativePath,
      destinationPath: operation.destinationPath,
      strategy: operation.strategy,
    })];
  }

  const relativeFiles = listFilesRecursive(sourcePath).filter(relativeFile => {
    const sourceRelativePath = path.join(operation.sourceRelativePath, relativeFile);
    return !isGeneratedRuntimeSourcePath(sourceRelativePath);
  });
  return relativeFiles.map(relativeFile => {
    const sourceRelativePath = path.join(operation.sourceRelativePath, relativeFile);
    return buildCopyFileOperation({
      moduleId: operation.moduleId,
      sourcePath: path.join(sourcePath, relativeFile),
      sourceRelativePath,
      destinationPath: path.join(operation.destinationPath, relativeFile),
      strategy: operation.strategy,
    });
  });
}

function createManifestInstallPlan(options = {}) {
  const sourceRoot = options.sourceRoot || getSourceRoot();
  const projectRoot = options.projectRoot || process.cwd();
  const target = options.target || 'claude';
  const legacyLanguages = Array.isArray(options.legacyLanguages)
    ? [...options.legacyLanguages]
    : [];
  const requestProfileId = Object.hasOwn(options, 'requestProfileId')
    ? options.requestProfileId
    : (options.profileId || null);
  const requestModuleIds = Object.hasOwn(options, 'requestModuleIds')
    ? [...options.requestModuleIds]
    : (Array.isArray(options.moduleIds) ? [...options.moduleIds] : []);
  const requestIncludeComponentIds = Object.hasOwn(options, 'requestIncludeComponentIds')
    ? [...options.requestIncludeComponentIds]
    : (Array.isArray(options.includeComponentIds) ? [...options.includeComponentIds] : []);
  const requestExcludeComponentIds = Object.hasOwn(options, 'requestExcludeComponentIds')
    ? [...options.requestExcludeComponentIds]
    : (Array.isArray(options.excludeComponentIds) ? [...options.excludeComponentIds] : []);
  const plan = resolveInstallPlan({
    repoRoot: sourceRoot,
    projectRoot,
    homeDir: options.homeDir,
    profileId: options.profileId || null,
    moduleIds: options.moduleIds || [],
    includeComponentIds: options.includeComponentIds || [],
    excludeComponentIds: options.excludeComponentIds || [],
    target,
  });
  const adapter = getInstallTargetAdapter(target);
  const operations = plan.operations.flatMap(operation => materializeScaffoldOperation(sourceRoot, operation));
  const source = {
    repoVersion: getPackageVersion(sourceRoot),
    repoCommit: getRepoCommit(sourceRoot),
    manifestVersion: getManifestVersion(sourceRoot),
  };
  const statePreview = createStatePreview({
    adapter,
    targetRoot: plan.targetRoot,
    installStatePath: plan.installStatePath,
    request: {
      profile: requestProfileId,
      modules: requestModuleIds,
      includeComponents: requestIncludeComponentIds,
      excludeComponents: requestExcludeComponentIds,
      legacyLanguages,
      legacyMode: Boolean(options.legacyMode),
    },
    resolution: {
      selectedModules: plan.selectedModuleIds,
      skippedModules: plan.skippedModuleIds,
    },
    operations,
    source,
  });

  return {
    mode: options.mode || 'manifest',
    target,
    adapter: {
      id: adapter.id,
      target: adapter.target,
      kind: adapter.kind,
    },
    targetRoot: plan.targetRoot,
    installRoot: plan.targetRoot,
    installStatePath: plan.installStatePath,
    warnings: Array.isArray(options.warnings) ? [...options.warnings] : [],
    languages: legacyLanguages,
    legacyLanguages,
    profileId: plan.profileId,
    requestedModuleIds: plan.requestedModuleIds,
    explicitModuleIds: plan.explicitModuleIds,
    includedComponentIds: plan.includedComponentIds,
    excludedComponentIds: plan.excludedComponentIds,
    selectedModuleIds: plan.selectedModuleIds,
    skippedModuleIds: plan.skippedModuleIds,
    excludedModuleIds: plan.excludedModuleIds,
    operations,
    statePreview,
  };
}

module.exports = {
  SUPPORTED_INSTALL_TARGETS,
  applyInstallPlan,
  createManifestInstallPlan,
  createStatePreview,
  materializeScaffoldOperation,
  getSourceRoot,
  CLAUDE_ESCC_NAMESPACE,
};
