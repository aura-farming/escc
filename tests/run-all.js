#!/usr/bin/env node
/*
 * ESCC hermetic unit-test runner.
 *
 * Zero external dependencies. Discovers every file matching tests/unit/*.test.js,
 * exposes a tiny global test/assert API, executes the collected tests (sync or
 * async), prints a summary, and exits non-zero if anything failed.
 *
 * Convention used by every test file:
 *
 *   test('does the thing', async () => {
 *     assert.equal(actual, expected, 'optional message');
 *   });
 *
 * `test(name, fn)` registers a case. The runner awaits each fn in registration
 * order. A thrown error (including a failed assertion) marks that case failed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const UNIT_DIR = path.join(__dirname, 'unit');
const TEST_FILE_SUFFIX = '.test.js';

// Registered cases: { name, fn, file }.
const cases = [];
let currentFile = '<unknown>';

/**
 * Register a single test case. Available as a global to every test file.
 * @param {string} name human-readable case name
 * @param {Function} fn sync or async test body; throwing fails the case
 */
function test(name, fn) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('test(name, fn): name must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new Error(`test(${name}): fn must be a function`);
  }
  cases.push({ name, fn, file: currentFile });
}

// Expose the API globally so test files can use it without importing the runner.
global.test = test;
global.assert = assert;

function discoverTestFiles() {
  let entries;
  try {
    entries = fs.readdirSync(UNIT_DIR, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX))
    .map(entry => path.join(UNIT_DIR, entry.name))
    .sort();
}

async function main() {
  const files = discoverTestFiles();

  if (files.length === 0) {
    console.error('No test files found under tests/unit/*.test.js');
    process.exit(1);
  }

  // Load every test file. Requiring it runs its top-level test() calls.
  for (const file of files) {
    currentFile = path.relative(__dirname, file);
    require(file);
  }
  currentFile = '<unknown>';

  let passed = 0;
  const failures = [];

  for (const testCase of cases) {
    try {
      await testCase.fn();
      passed += 1;
      console.log(`  PASS  ${testCase.file} :: ${testCase.name}`);
    } catch (err) {
      failures.push({ testCase, err });
      console.log(`  FAIL  ${testCase.file} :: ${testCase.name}`);
    }
  }

  console.log('');
  console.log('='.repeat(60));

  if (failures.length > 0) {
    console.log(`Failures (${failures.length}):`);
    for (const { testCase, err } of failures) {
      console.log('');
      console.log(`  ${testCase.file} :: ${testCase.name}`);
      const message = (err && err.stack) ? err.stack : String(err);
      console.log(message.split('\n').map(line => `    ${line}`).join('\n'));
    }
    console.log('');
    console.log('='.repeat(60));
  }

  const total = cases.length;
  console.log(`Tests: ${total} | Passed: ${passed} | Failed: ${failures.length} | Files: ${files.length}`);

  if (failures.length > 0) {
    console.log('RESULT: FAIL');
    process.exit(1);
  }

  console.log('RESULT: PASS');
  process.exit(0);
}

main().catch(err => {
  console.error('Test runner crashed:');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
