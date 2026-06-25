'use strict';

/*
 * Schema tests for the persona/role-keyed knowledge layer (ADR-0012).
 *
 * Mirrors tests/unit/schemas.test.js (compile + accept-realistic + reject-
 * malformed), and IMPROVES on it: the existing schema tests validate only inline
 * literals, never a file on disk. These cases load the committed seed/example and
 * the committed controlled-vocabulary FROM DISK and validate them against their
 * schemas — so the shipped artifacts cannot drift out of shape unnoticed.
 *
 * product-knowledge.schema.json is draft 2020-12 (mirrors state-store.schema.json,
 * the store-schema precedent), so it compiles with ajv/dist/2020.
 * knowledge-vocab.schema.json is draft-07 (mirrors provenance.schema.json, the
 * single-record precedent), so it compiles with the default ajv build.
 */

const fs = require('fs');
const path = require('path');

const Ajv2020 = (m => m.default || m)(require('ajv/dist/2020'));
const Ajv = (m => m.default || m)(require('ajv'));

const ROOT = path.join(__dirname, '..', '..');
const SCHEMA_DIR = path.join(ROOT, 'schemas');

function compileStore() {
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'product-knowledge.schema.json'), 'utf8'));
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}
function compileVocab() {
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'knowledge-vocab.schema.json'), 'utf8'));
  return new Ajv({ allErrors: true, strict: false }).compile(schema);
}

/** Validate a single entry by wrapping it in the store array. */
function entryOk(v, entry) {
  return v([entry]);
}

// A legacy entry exactly as the live store shapes them today (no new fields).
const LEGACY = {
  id: 'PK-99', type: 'value-prop',
  text: 'Tanda builds a compliant draft roster for a manager to review before publishing.',
  segment: 'hospitality, retail',
  source_title: 'Roster Agent', source_url: 'https://help.tanda.co/',
  source_type: 'public', approved: true, approved_by: 'Lucas', last_verified: '2026-06-24',
  guardrail: 'Capability claim, fine for cold email.',
};

test('product-knowledge schema: compiles and accepts the committed example seed from disk', () => {
  const v = compileStore();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'product-knowledge.example.json'), 'utf8'));
  assert.ok(v(seed), JSON.stringify(v.errors));
});

test('product-knowledge schema: accepts a legacy entry unchanged (backward compatible)', () => {
  const v = compileStore();
  assert.ok(entryOk(v, LEGACY), JSON.stringify(v.errors));
});

test('product-knowledge schema: accepts each new type (objection / pain / battlecard)', () => {
  const v = compileStore();
  assert.ok(entryOk(v, {
    id: 'OBJ-1', type: 'objection', pattern: 'We already have payroll software.',
    response: 'Tanda feeds payroll, it does not replace it.', role: 'finance',
    source_type: 'manual', approved: true,
  }), 'objection: ' + JSON.stringify(v.errors));
  assert.ok(entryOk(v, {
    id: 'PAIN-1', type: 'pain', role: 'operations',
    text: 'No live labour cost per venue until after the pay run.',
    segment: 'multi-site', source_type: 'manual', approved: true,
  }), 'pain: ' + JSON.stringify(v.errors));
  assert.ok(entryOk(v, {
    id: 'BC-1', type: 'battlecard', competitor: 'deputy',
    differentiation: 'Built-in award automation rather than a configure-it-yourself rules engine.',
    guardrail: 'Differentiation only; do not assert what the competitor does.',
    source_type: 'public', approved: true,
  }), 'battlecard: ' + JSON.stringify(v.errors));
});

test('product-knowledge schema: rejects malformed entries (missing required per type)', () => {
  const v = compileStore();
  assert.equal(entryOk(v, { type: 'claim', text: 'x', source_type: 'public', approved: true }), false, 'missing id');
  assert.equal(entryOk(v, { id: 'X', type: 'claim', text: 'x', approved: true }), false, 'missing source_type');
  assert.equal(entryOk(v, { id: 'X', type: 'value-prop', source_type: 'public', approved: true }), false, 'capability type missing text');
  assert.equal(entryOk(v, { id: 'X', type: 'objection', pattern: 'p', source_type: 'manual', approved: true }), false, 'objection missing response');
  assert.equal(entryOk(v, { id: 'X', type: 'pain', text: 'p', source_type: 'manual', approved: true }), false, 'pain missing role');
  assert.equal(entryOk(v, { id: 'X', type: 'battlecard', competitor: 'deputy', differentiation: 'd', source_type: 'public', approved: true }), false, 'battlecard missing guardrail');
  assert.equal(entryOk(v, { id: 'X', type: 'webinar', text: 'x', source_type: 'public', approved: true }), false, 'unknown type');
});

test('product-knowledge schema: rejects the contradiction approved:true + untrusted:true (fabrication firewall)', () => {
  const v = compileStore();
  assert.equal(entryOk(v, { ...LEGACY, untrusted: true }), false, 'approved:true must never be untrusted:true');
  // ...but a candidate (approved:false + untrusted:true) is fine.
  assert.ok(entryOk(v, { id: 'C', type: 'claim', text: 'x', source_type: 'call', approved: false, untrusted: true }), JSON.stringify(v.errors));
});

test('product-knowledge schema: candidate example lines validate AND are flagged not-approved + untrusted', () => {
  const v = compileStore();
  const raw = fs.readFileSync(path.join(ROOT, 'examples', 'product-knowledge.candidate.example.jsonl'), 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  assert.ok(lines.length >= 1, 'candidate example must have at least one line');
  for (const line of lines) {
    const entry = JSON.parse(line);
    assert.ok(entryOk(v, entry), `candidate ${entry.id}: ${JSON.stringify(v.errors)}`);
    assert.equal(entry.approved, false, `candidate ${entry.id} must be approved:false`);
    assert.equal(entry.untrusted, true, `candidate ${entry.id} must be untrusted:true`);
  }
});

test('knowledge-vocab schema: compiles and accepts the committed config from disk', () => {
  const v = compileVocab();
  const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'knowledge-vocab.json'), 'utf8'));
  assert.ok(v(vocab), JSON.stringify(v.errors));
});

test('knowledge-vocab: cross-field integrity (mapped roles + fallback are in roles; general is a role and a segment)', () => {
  const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'knowledge-vocab.json'), 'utf8'));
  const roles = new Set(vocab.roles);
  assert.ok(roles.has(vocab.fallback_role), `fallback_role ${vocab.fallback_role} must be a known role`);
  for (const rule of vocab.title_to_role) {
    assert.ok(roles.has(rule.role), `title_to_role role ${rule.role} must be a known role`);
  }
  assert.ok(roles.has('general'), 'roles must include "general" (the fallback target)');
  assert.ok(new Set(vocab.segments).has('general'), 'segments must include "general" (the catch-all industry)');
});

test('knowledge-vocab schema: rejects a malformed vocab (rule missing role, unknown top-level key)', () => {
  const v = compileVocab();
  assert.equal(v({ version: 1, roles: ['general'], segments: ['general'], competitors: [], title_to_role: [{ match: ['cfo'] }], fallback_role: 'general' }), false, 'rule missing role');
  assert.equal(v({ version: 1, roles: ['general'], segments: ['general'], competitors: [], title_to_role: [], fallback_role: 'general', bogus: 1 }), false, 'unknown top-level key');
});
