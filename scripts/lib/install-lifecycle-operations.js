/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-lifecycle.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Per-operation execution and inspection for managed install operations:
 * selecting managed operations, resolving source paths, hydrating recorded
 * operations, executing repair/uninstall for each operation kind (copy-file,
 * render-template, merge-json, remove), and summarizing operation health.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  areFilesEqual,
  readFileUtf8,
  getOperationTextContent,
  getOperationJsonPayload,
  getOperationPreviousContent,
  getOperationPreviousJson,
  formatJson,
  readJsonFile,
  ensureParentDir,
  deepMergeJson,
  jsonContainsSubset,
  JSON_REMOVE_SENTINEL,
  deepRemoveJsonSubset,
} = require('./install-lifecycle-ops');

function getManagedOperations(state) {
  return Array.isArray(state && state.operations)
    ? state.operations.filter(operation => operation.ownership === 'managed')
    : [];
}

function resolveOperationSourcePath(repoRoot, operation) {
  if (operation.sourceRelativePath) {
    return path.join(repoRoot, operation.sourceRelativePath);
  }

  return operation.sourcePath || null;
}

function hydrateRecordedOperations(repoRoot, operations) {
  return operations.map(operation => {
    if (operation.kind !== 'copy-file') {
      return { ...operation };
    }

    return {
      ...operation,
      sourcePath: resolveOperationSourcePath(repoRoot, operation),
    };
  });
}

function buildRecordedStatePreview(state, context, operations) {
  return {
    ...state,
    operations: operations.map(operation => ({ ...operation })),
    source: {
      ...state.source,
      repoVersion: context.packageVersion,
      manifestVersion: context.manifestVersion,
    },
    lastValidatedAt: new Date().toISOString(),
  };
}

function shouldRepairFromRecordedOperations(state) {
  return getManagedOperations(state).some(operation => operation.kind !== 'copy-file');
}

function executeRepairOperation(repoRoot, operation) {
  if (operation.kind === 'copy-file') {
    const sourcePath = resolveOperationSourcePath(repoRoot, operation);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Missing source file for repair: ${sourcePath || operation.sourceRelativePath}`);
    }

    ensureParentDir(operation.destinationPath);
    fs.copyFileSync(sourcePath, operation.destinationPath);
    return;
  }

  if (operation.kind === 'render-template') {
    const renderedContent = getOperationTextContent(operation);
    if (renderedContent === null) {
      throw new Error(`Missing rendered content for repair: ${operation.destinationPath}`);
    }

    ensureParentDir(operation.destinationPath);
    fs.writeFileSync(operation.destinationPath, renderedContent);
    return;
  }

  if (operation.kind === 'merge-json') {
    const payload = getOperationJsonPayload(operation);
    if (payload === undefined) {
      throw new Error(`Missing merge payload for repair: ${operation.destinationPath}`);
    }

    const currentValue = fs.existsSync(operation.destinationPath)
      ? readJsonFile(operation.destinationPath)
      : {};
    const mergedValue = deepMergeJson(currentValue, payload);

    ensureParentDir(operation.destinationPath);
    fs.writeFileSync(operation.destinationPath, formatJson(mergedValue));
    return;
  }

  if (operation.kind === 'remove') {
    if (!fs.existsSync(operation.destinationPath)) {
      return;
    }

    fs.rmSync(operation.destinationPath, { recursive: true, force: true });
    return;
  }

  throw new Error(`Unsupported repair operation kind: ${operation.kind}`);
}

function executeUninstallOperation(operation) {
  if (operation.kind === 'copy-file') {
    if (!fs.existsSync(operation.destinationPath)) {
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    fs.rmSync(operation.destinationPath, { force: true });
    return {
      removedPaths: [operation.destinationPath],
      cleanupTargets: [operation.destinationPath],
    };
  }

  if (operation.kind === 'render-template') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, previousContent);
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, formatJson(previousJson));
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    if (!fs.existsSync(operation.destinationPath)) {
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    fs.rmSync(operation.destinationPath, { force: true });
    return {
      removedPaths: [operation.destinationPath],
      cleanupTargets: [operation.destinationPath],
    };
  }

  if (operation.kind === 'merge-json') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, previousContent);
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, formatJson(previousJson));
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    if (!fs.existsSync(operation.destinationPath)) {
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    const payload = getOperationJsonPayload(operation);
    if (payload === undefined) {
      throw new Error(`Missing merge payload for uninstall: ${operation.destinationPath}`);
    }

    const currentValue = readJsonFile(operation.destinationPath);
    const nextValue = deepRemoveJsonSubset(currentValue, payload);
    if (nextValue === JSON_REMOVE_SENTINEL) {
      fs.rmSync(operation.destinationPath, { force: true });
      return {
        removedPaths: [operation.destinationPath],
        cleanupTargets: [operation.destinationPath],
      };
    }

    ensureParentDir(operation.destinationPath);
    fs.writeFileSync(operation.destinationPath, formatJson(nextValue));
    return {
      removedPaths: [],
      cleanupTargets: [],
    };
  }

  if (operation.kind === 'remove') {
    const previousContent = getOperationPreviousContent(operation);
    if (previousContent !== null) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, previousContent);
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    const previousJson = getOperationPreviousJson(operation);
    if (previousJson !== undefined) {
      ensureParentDir(operation.destinationPath);
      fs.writeFileSync(operation.destinationPath, formatJson(previousJson));
      return {
        removedPaths: [],
        cleanupTargets: [],
      };
    }

    return {
      removedPaths: [],
      cleanupTargets: [],
    };
  }

  throw new Error(`Unsupported uninstall operation kind: ${operation.kind}`);
}

function inspectManagedOperation(repoRoot, operation) {
  const destinationPath = operation.destinationPath;
  if (!destinationPath) {
    return {
      status: 'invalid-destination',
      operation,
    };
  }

  if (operation.kind === 'remove') {
    if (fs.existsSync(destinationPath)) {
      return {
        status: 'drifted',
        operation,
        destinationPath,
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath,
    };
  }

  if (!fs.existsSync(destinationPath)) {
    return {
      status: 'missing',
      operation,
      destinationPath,
    };
  }

  if (operation.kind === 'copy-file') {
    const sourcePath = resolveOperationSourcePath(repoRoot, operation);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return {
        status: 'missing-source',
        operation,
        destinationPath,
        sourcePath,
      };
    }

    if (!areFilesEqual(sourcePath, destinationPath)) {
      return {
        status: 'drifted',
        operation,
        destinationPath,
        sourcePath,
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath,
      sourcePath,
    };
  }

  if (operation.kind === 'render-template') {
    const renderedContent = getOperationTextContent(operation);
    if (renderedContent === null) {
      return {
        status: 'unverified',
        operation,
        destinationPath,
      };
    }

    if (readFileUtf8(destinationPath) !== renderedContent) {
      return {
        status: 'drifted',
        operation,
        destinationPath,
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath,
    };
  }

  if (operation.kind === 'merge-json') {
    const payload = getOperationJsonPayload(operation);
    if (payload === undefined) {
      return {
        status: 'unverified',
        operation,
        destinationPath,
      };
    }

    try {
      const currentValue = readJsonFile(destinationPath);
      if (!jsonContainsSubset(currentValue, payload)) {
        return {
          status: 'drifted',
          operation,
          destinationPath,
        };
      }
    } catch (_error) {
      return {
        status: 'drifted',
        operation,
        destinationPath,
      };
    }

    return {
      status: 'ok',
      operation,
      destinationPath,
    };
  }

  return {
    status: 'unverified',
    operation,
    destinationPath,
  };
}

function summarizeManagedOperationHealth(repoRoot, operations) {
  return operations.reduce((summary, operation) => {
    const inspection = inspectManagedOperation(repoRoot, operation);
    if (inspection.status === 'missing') {
      summary.missing.push(inspection);
    } else if (inspection.status === 'drifted') {
      summary.drifted.push(inspection);
    } else if (inspection.status === 'missing-source') {
      summary.missingSource.push(inspection);
    } else if (inspection.status === 'unverified' || inspection.status === 'invalid-destination') {
      summary.unverified.push(inspection);
    }
    return summary;
  }, {
    missing: [],
    drifted: [],
    missingSource: [],
    unverified: [],
  });
}

module.exports = {
  getManagedOperations,
  resolveOperationSourcePath,
  hydrateRecordedOperations,
  buildRecordedStatePreview,
  shouldRepairFromRecordedOperations,
  executeRepairOperation,
  executeUninstallOperation,
  inspectManagedOperation,
  summarizeManagedOperationHealth,
};
