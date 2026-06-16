'use strict';

/*
 * Tests for the remaining JSON Schemas (spec §7 "Schemas (10)"):
 *   install-profiles, install-modules, install-components, provenance,
 *   gtm-stack-mappings.
 *
 * For each: the schema is itself a valid (draft-07) schema that compiles, it
 * ACCEPTS a realistic artifact (the install-* fixtures match the exact shapes
 * scripts/lib/install-manifests.js reads), and it REJECTS a malformed one.
 * These schemas are standalone contract artifacts — the manifest loader is
 * shape-implicit, and Phase 6 CI validators consume the schemas.
 */

const fs = require('fs');
const path = require('path');

const Ajv = (m => m.default || m)(require('ajv'));

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'schemas');

function compile(name) {
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));
  return new Ajv({ allErrors: true, strict: false }).compile(schema);
}

test('install-modules: compiles and accepts a realistic manifest', () => {
  const v = compile('install-modules.schema.json');
  const ok = v({
    version: 1,
    modules: [
      { id: 'rules-core', kind: 'rules', description: 'd', paths: ['rules'], targets: ['claude', 'claude-project'], dependencies: [], defaultInstall: true, cost: 'light', stability: 'stable' },
      { id: 'skill-cold-calling', kind: 'skills', paths: ['skills/cold-calling'], targets: ['claude'], synthetic: true },
    ],
  });
  assert.ok(ok, JSON.stringify(v.errors));
});

test('install-modules: rejects a module missing id, and an unsupported target', () => {
  const v = compile('install-modules.schema.json');
  assert.equal(v({ version: 1, modules: [{ kind: 'rules', paths: ['rules'], targets: ['claude'] }] }), false, 'missing id');
  assert.equal(v({ version: 1, modules: [{ id: 'x', kind: 'rules', paths: ['x'], targets: ['cursor'] }] }), false, 'unsupported target');
});

test('install-profiles: accepts the profile map shape', () => {
  const v = compile('install-profiles.schema.json');
  const ok = v({ version: 1, profiles: { full: { description: 'everything', modules: ['rules-core'] }, sdr: { modules: ['rules-core'] } } });
  assert.ok(ok, JSON.stringify(v.errors));
});

test('install-profiles: rejects a profile whose modules is not an array', () => {
  const v = compile('install-profiles.schema.json');
  assert.equal(v({ version: 1, profiles: { full: { modules: 'rules-core' } } }), false);
});

test('install-components: accepts a component', () => {
  const v = compile('install-components.schema.json');
  const ok = v({ version: 1, components: [{ id: 'capability:forecasting', family: 'capability', description: 'd', modules: ['m1'] }] });
  assert.ok(ok, JSON.stringify(v.errors));
  assert.ok(v({ version: null, components: [] }), 'tolerates a null version + empty components');
});

test('install-components: rejects a component missing id', () => {
  const v = compile('install-components.schema.json');
  assert.equal(v({ version: 1, components: [{ family: 'capability', modules: ['m1'] }] }), false);
});

test('provenance: accepts a per-field record and requires source', () => {
  const v = compile('provenance.schema.json');
  assert.ok(v({ source: 'hubspot', source_type: 'crm', field: 'amount', retrieved_at: '2026-06-16T00:00:00Z', lawful_basis: 'legitimate_interest', untrusted: false, confidence: 0.9 }), JSON.stringify(v.errors));
  assert.equal(v({}), false, 'source is required');
  assert.equal(v({ source: 'web', source_type: 'telepathy' }), false, 'source_type is enumerated');
});

test('gtm-stack-mappings: accepts an indicator -> recommends mapping', () => {
  const v = compile('gtm-stack-mappings.schema.json');
  const ok = v({ version: 1, mappings: [{ indicator: 'mcp__hubspot__*', label: 'HubSpot CRM', recommends: { skills: ['crm-hygiene'], rules: ['lifecycle-stages'], hooks: ['crm-write-guard'], profile: 'sdr' } }] });
  assert.ok(ok, JSON.stringify(v.errors));
});

test('gtm-stack-mappings: rejects a mapping missing its indicator', () => {
  const v = compile('gtm-stack-mappings.schema.json');
  assert.equal(v({ version: 1, mappings: [{ recommends: { profile: 'sdr' } }] }), false);
});
