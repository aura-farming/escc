/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-lifecycle.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Pure JSON/file helpers extracted from the install-lifecycle module: reading
 * package versions, comparing string arrays, byte/JSON file equality, JSON
 * cloning/merging, subset matching, sentinel-driven subset removal, and bounded
 * empty-parent-directory cleanup. No install-domain imports live here.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function readPackageVersion(repoRoot) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return packageJson.version || null;
  } catch (_error) {
    return null;
  }
}

function compareStringArrays(left, right) {
  const leftValues = Array.isArray(left) ? left : [];
  const rightValues = Array.isArray(right) ? right : [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => value === rightValues[index]);
}

function areFilesEqual(leftPath, rightPath) {
  try {
    const leftStat = fs.statSync(leftPath);
    const rightStat = fs.statSync(rightPath);
    if (!leftStat.isFile() || !rightStat.isFile()) {
      return false;
    }

    return fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
  } catch (_error) {
    return false;
  }
}

function readFileUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function parseJsonLikeValue(value, label) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid ${label}: ${error.message}`);
    }
  }

  if (value === null || Array.isArray(value) || isPlainObject(value) || typeof value === 'number' || typeof value === 'boolean') {
    return cloneJsonValue(value);
  }

  throw new Error(`Invalid ${label}: expected JSON-compatible data`);
}

function getOperationTextContent(operation) {
  const candidateKeys = [
    'renderedContent',
    'content',
    'managedContent',
    'expectedContent',
    'templateOutput',
  ];

  for (const key of candidateKeys) {
    if (typeof operation[key] === 'string') {
      return operation[key];
    }
  }

  return null;
}

function getOperationJsonPayload(operation) {
  const candidateKeys = [
    'mergePayload',
    'managedPayload',
    'payload',
    'value',
    'expectedValue',
  ];

  for (const key of candidateKeys) {
    if (operation[key] !== undefined) {
      return parseJsonLikeValue(operation[key], `${operation.kind}.${key}`);
    }
  }

  return undefined;
}

function getOperationPreviousContent(operation) {
  const candidateKeys = [
    'previousContent',
    'originalContent',
    'backupContent',
  ];

  for (const key of candidateKeys) {
    if (typeof operation[key] === 'string') {
      return operation[key];
    }
  }

  return null;
}

function getOperationPreviousJson(operation) {
  const candidateKeys = [
    'previousValue',
    'previousJson',
    'originalValue',
  ];

  for (const key of candidateKeys) {
    if (operation[key] !== undefined) {
      return parseJsonLikeValue(operation[key], `${operation.kind}.${key}`);
    }
  }

  return undefined;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileUtf8(filePath));
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function deepMergeJson(baseValue, patchValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeJson(merged[key], value);
    } else {
      merged[key] = cloneJsonValue(value);
    }
  }
  return merged;
}

function jsonContainsSubset(actualValue, expectedValue) {
  if (isPlainObject(expectedValue)) {
    if (!isPlainObject(actualValue)) {
      return false;
    }

    return Object.entries(expectedValue).every(([key, value]) => (
      Object.prototype.hasOwnProperty.call(actualValue, key)
      && jsonContainsSubset(actualValue[key], value)
    ));
  }

  if (Array.isArray(expectedValue)) {
    if (!Array.isArray(actualValue) || actualValue.length !== expectedValue.length) {
      return false;
    }

    return expectedValue.every((item, index) => jsonContainsSubset(actualValue[index], item));
  }

  return actualValue === expectedValue;
}

const JSON_REMOVE_SENTINEL = Symbol('json-remove');

function deepRemoveJsonSubset(currentValue, managedValue) {
  if (isPlainObject(managedValue)) {
    if (!isPlainObject(currentValue)) {
      return currentValue;
    }

    const nextValue = { ...currentValue };
    for (const [key, value] of Object.entries(managedValue)) {
      if (!Object.prototype.hasOwnProperty.call(nextValue, key)) {
        continue;
      }

      if (isPlainObject(value)) {
        const nestedValue = deepRemoveJsonSubset(nextValue[key], value);
        if (nestedValue === JSON_REMOVE_SENTINEL) {
          delete nextValue[key];
        } else {
          nextValue[key] = nestedValue;
        }
        continue;
      }

      if (Array.isArray(value)) {
        if (Array.isArray(nextValue[key]) && jsonContainsSubset(nextValue[key], value)) {
          delete nextValue[key];
        }
        continue;
      }

      if (nextValue[key] === value) {
        delete nextValue[key];
      }
    }

    return Object.keys(nextValue).length === 0 ? JSON_REMOVE_SENTINEL : nextValue;
  }

  if (Array.isArray(managedValue)) {
    return jsonContainsSubset(currentValue, managedValue) ? JSON_REMOVE_SENTINEL : currentValue;
  }

  return currentValue === managedValue ? JSON_REMOVE_SENTINEL : currentValue;
}

function cleanupEmptyParentDirs(filePath, stopAt) {
  let currentPath = path.dirname(filePath);
  const normalizedStopAt = path.resolve(stopAt);

  while (
    currentPath
    && path.resolve(currentPath).startsWith(normalizedStopAt)
    && path.resolve(currentPath) !== normalizedStopAt
  ) {
    if (!fs.existsSync(currentPath)) {
      currentPath = path.dirname(currentPath);
      continue;
    }

    const stat = fs.lstatSync(currentPath);
    if (!stat.isDirectory() || fs.readdirSync(currentPath).length > 0) {
      break;
    }

    fs.rmdirSync(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

module.exports = {
  readPackageVersion,
  compareStringArrays,
  areFilesEqual,
  readFileUtf8,
  isPlainObject,
  cloneJsonValue,
  parseJsonLikeValue,
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
  cleanupEmptyParentDirs,
};
