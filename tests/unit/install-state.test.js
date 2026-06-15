'use strict';

/*
 * Unit tests for scripts/lib/install-state.js (ported from ECC).
 *
 * Covers: schemaVersion is stamped 'escc.install.v1'; write->read round-trips
 * byte-stable; validation rejects a wrong version, a bad target.kind, and an
 * additional property; writeInstallState refuses to persist an invalid record.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  createInstallState,
  writeInstallState,
  readInstallState,
  validateInstallState,
} = require('../../scripts/lib/install-state.js');

function baseOptions(overrides = {}) {
  return {
    adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
    targetRoot: path.join(os.tmpdir(), 'escc-x', '.claude'),
    installStatePath: path.join(os.tmpdir(), 'escc-x', '.claude', 'escc', 'install-state.json'),
    installedAt: '2026-06-15T00:00:00.000Z',
    request: {
      profile: 'core',
      modules: ['rules-core'],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: { selectedModules: ['rules-core'], skippedModules: [] },
    source: { repoVersion: '0.1.0', repoCommit: null, manifestVersion: 1 },
    operations: [],
    ...overrides,
  };
}

test('install-state: createInstallState stamps escc.install.v1 and is valid', () => {
  const state = createInstallState(baseOptions());
  assert.equal(state.schemaVersion, 'escc.install.v1');
  assert.equal(validateInstallState(state).valid, true);
});

test('install-state: write then read round-trips byte-stable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-is-'));
  try {
    const file = path.join(dir, 'escc', 'install-state.json');
    const state = createInstallState(baseOptions({ installStatePath: file }));
    writeInstallState(file, state);
    const back = readInstallState(file);
    assert.deepStrictEqual(back, state);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install-state: validateInstallState rejects the old ecc.install.v1 version', () => {
  const state = createInstallState(baseOptions());
  const bad = { ...state, schemaVersion: 'ecc.install.v1' };
  assert.equal(validateInstallState(bad).valid, false);
});

test('install-state: validateInstallState rejects an invalid target.kind', () => {
  const state = createInstallState(baseOptions());
  const bad = { ...state, target: { ...state.target, kind: 'nope' } };
  assert.equal(validateInstallState(bad).valid, false);
});

test('install-state: validateInstallState rejects unknown top-level properties', () => {
  const state = createInstallState(baseOptions());
  const bad = { ...state, surprise: true };
  assert.equal(validateInstallState(bad).valid, false);
});

test('install-state: writeInstallState refuses to persist an invalid record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-is-'));
  try {
    const file = path.join(dir, 'install-state.json');
    assert.throws(() => writeInstallState(file, { schemaVersion: 'escc.install.v1' }));
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
