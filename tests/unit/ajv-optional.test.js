/*
 * Tests that the RUNTIME validators degrade gracefully when ajv is absent.
 *
 * ajv is ESCC's SOLE external dependency, and a Claude Code plugin/marketplace
 * install does NOT run `npm install` — so node_modules (hence ajv) can be missing
 * at runtime. A top-level `require('ajv')` in a module that nearly every hook and
 * the escc CLI transitively load would crash the whole state-backed machinery,
 * and (proven empirically) make the fail-closed outbound send-gate FAIL OPEN.
 *
 * These tests reproduce that runtime by spawning a child node process whose
 * module loader throws MODULE_NOT_FOUND for any `require('ajv'…)`, then confirm
 * the two runtime validators (state-store schema + instinct-store) LOAD and work
 * in a degraded, validation-skipping mode instead of crashing. The npm-installed
 * dev/CI runtime (this process) still has ajv, so the schema stays fully enforced
 * everywhere else in the suite — this file is the only no-ajv coverage.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const schemaPath = path.join(repoRoot, 'scripts', 'lib', 'state-store', 'schema.js');
const instinctStorePath = path.join(repoRoot, 'scripts', 'instincts', 'instinct-store.js');
const storeIndexPath = path.join(repoRoot, 'scripts', 'lib', 'state-store', 'index.js');

/**
 * Run a JS body in a child node process with ajv HIDDEN: any `require('ajv'…)`
 * throws MODULE_NOT_FOUND, exactly as in a marketplace install with no
 * node_modules. Returns the spawnSync result ({ status, stdout, stderr }).
 */
function runWithoutAjv(body, env = {}) {
  const script = `
    const Module = require('module');
    const _load = Module._load;
    Module._load = function (request) {
      if (request === 'ajv' || request.indexOf('ajv/') === 0) {
        const e = new Error("Cannot find module '" + request + "' (hidden by test)");
        e.code = 'MODULE_NOT_FOUND';
        throw e;
      }
      return _load.apply(this, arguments);
    };
    ${body}
  `;
  return spawnSync('node', ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30000,
  });
}

// --- the harness itself must genuinely hide ajv (guard against a false pass) ---

test('the no-ajv harness actually makes require(ajv) throw MODULE_NOT_FOUND', () => {
  const body = `
    const assert = require('assert');
    let code = null;
    try { require('ajv/dist/2020'); } catch (e) { code = e.code; }
    assert.strictEqual(code, 'MODULE_NOT_FOUND', 'ajv must be hidden in the child');
    console.log('HARNESS_OK');
  `;
  const r = runWithoutAjv(body);
  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  assert.match(r.stdout, /HARNESS_OK/);
});

// --- state-store schema validator -------------------------------------------

test('state-store/schema.js loads without ajv and skips validation gracefully', () => {
  const body = `
    const assert = require('assert');
    const schema = require(${JSON.stringify(schemaPath)});
    const r = schema.validateEntity('session', { totally: 'not a valid session' });
    assert.strictEqual(r.valid, true, 'validateEntity must report valid when ajv is absent');
    assert.deepStrictEqual(r.errors, [], 'no errors in degraded mode');
    schema.assertValidEntity('session', { totally: 'invalid' }); // must NOT throw
    console.log('SCHEMA_OK');
  `;
  const r = runWithoutAjv(body);
  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  assert.match(r.stdout, /SCHEMA_OK/);
});

// --- instinct store validator + write/read ----------------------------------

test('instinct-store.js loads without ajv; validate skips and write/read works', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-noajv-inst-'));
  const body = `
    const assert = require('assert');
    const fs = require('fs');
    const store = require(${JSON.stringify(instinctStorePath)});
    const v = store.validateInstinct({ totally: 'invalid' });
    assert.strictEqual(v.valid, true, 'validateInstinct must be valid when ajv absent');
    const inst = {
      id: 'noajv-test', trigger: 'when X happens', action: 'do Y',
      confidence: 0.9, scope: 'personal', domain: 'sales', source: 'test',
    };
    const file = store.writeInstinct(inst, 'personal'); // assertValidInstinct is a no-op now
    assert.ok(fs.existsSync(file), 'instinct file must be written');
    const all = store.readInstincts('personal');
    assert.ok(all.some(i => i.id === 'noajv-test'), 'written instinct must read back');
    console.log('INSTINCT_OK');
  `;
  const r = runWithoutAjv(body, { ESCC_INSTINCT_HOME: tmpHome });
  try {
    assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
    assert.match(r.stdout, /INSTINCT_OK/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// --- state store round-trip (the dependency chain the send-gate sits on) -----

test('state-store persists + reads an entity without ajv (real upsert path)', () => {
  const body = `
    const assert = require('assert');
    const { createStateStoreSync } = require(${JSON.stringify(storeIndexPath)});
    const store = createStateStoreSync({ memory: true });
    // assertValidEntity (called by every upsert) must be a no-op, not a throw.
    store.assertValidEntity('session', { anything: true });
    const saved = store.upsertSession({ id: 'sess-noajv', adapterId: 'a', harness: 'test', state: 'active' });
    assert.ok(saved && saved.id === 'sess-noajv', 'session must round-trip without ajv');
    store.close();
    console.log('STORE_OK');
  `;
  const r = runWithoutAjv(body);
  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  assert.match(r.stdout, /STORE_OK/);
});
