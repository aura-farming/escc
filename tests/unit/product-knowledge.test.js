'use strict';

/*
 * Unit tests for scripts/lib/product-knowledge.js — the retrieval ladder, vocab
 * resolution/validation, candidate ingest, freshness, and gap logging (ADR-0012).
 *
 * Hermetic, mirroring tests/unit/account-memory.test.js: each case runs against a
 * fresh ESCC_AGENT_DATA_HOME temp dir and a deterministic `now`. Tests the THREAT
 * (approved-only, fresh-only, candidate forced-flags, never-throws), not just the
 * happy path.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const pk = require('../../scripts/lib/product-knowledge');

const NOW = '2026-06-25T00:00:00Z';
const FRESH = '2026-06-20'; // within both cadences
const STALE = '2025-01-01'; // past both cadences

/** Run fn with a fresh temp data home seeded with `entries` (or no store if null). */
function withHome(entries, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-pk-'));
  const prev = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = home;
  try {
    if (entries) {
      const dir = path.join(home, 'escc', 'product');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'product-knowledge.json'), JSON.stringify(entries));
    }
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prev;
  }
}

const STORE = [
  { id: 'A', type: 'value-prop', text: 'finance hospitality', segment: 'hospitality, retail', role: 'finance', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'B', type: 'value-prop', text: 'general proof', segment: 'general', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'F', type: 'value-prop', text: 'industry hospitality, untagged role', segment: 'hospitality', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'BC', type: 'battlecard', competitor: 'deputy', role: 'owner', segment: 'general', differentiation: 'award automation', guardrail: 'differentiation only', text: 'vs deputy', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'OLD', type: 'value-prop', text: 'aged care, stale', segment: 'aged care', source_type: 'public', approved: true, last_verified: STALE },
];

const ids = r => r.entries.map(e => e.id);

test('ladder: most-specific role+segment match wins over general', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'finance', segment: 'hospitality' }, { now: NOW, logGap: false });
    assert.ok(r.found, 'should find a match');
    assert.equal(r.tier, 'role+segment');
    assert.deepEqual(ids(r), ['A']);
  });
});

test('ladder: a role with no entries falls back to the industry (segment) entry', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'hr', segment: 'hospitality' }, { now: NOW, logGap: false });
    assert.ok(r.found);
    assert.equal(r.tier, 'segment');
    assert.deepEqual(ids(r), ['F'], 'finance (A) is a different role and must not surface; untagged hospitality (F) does');
  });
});

test('ladder: competitor battlecard returns the most specific tier and carries its guardrail', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'owner', segment: 'general', competitor: 'deputy', type: 'battlecard' }, { now: NOW, logGap: false });
    assert.ok(r.found);
    assert.equal(r.tier, 'role+segment+competitor');
    assert.deepEqual(ids(r), ['BC']);
    assert.ok(r.entries[0].guardrail, 'battlecard entry must carry a guardrail');
  });
});

test('ladder: clean miss returns the no-proof sentinel and logs a gap', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'payroll', segment: 'aged care', type: 'objection' }, { now: NOW });
    assert.equal(r.found, false);
    assert.ok(/^no approved proof for /.test(r.sentinel), r.sentinel);
    const gaps = pk.readGaps();
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].role, 'payroll');
    assert.equal(gaps[0].segment, 'aged care');
    assert.equal(gaps[0].type, 'objection');
  });
});

test('freshness: a stale entry is excluded from entries and flagged in stale', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ segment: 'aged care' }, { now: NOW, logGap: false });
    assert.ok(!ids(r).includes('OLD'), 'stale entry must not be quotable');
    assert.ok(r.stale.some(e => e.id === 'OLD'), 'stale entry must be flagged as a hypothesis');
  });
});

test('retrieve never throws when the store is missing', () => {
  withHome(null, () => {
    const r = pk.retrieve({ role: 'finance', segment: 'hospitality' }, { now: NOW, logGap: false });
    assert.equal(r.found, false);
    assert.ok(r.sentinel);
  });
});

test('readApproved defensively drops not-approved and untrusted rows (firewall)', () => {
  const mixed = [
    { id: 'good', type: 'claim', text: 'ok', source_type: 'public', approved: true },
    { id: 'pending', type: 'claim', text: 'no', source_type: 'public', approved: false },
    { id: 'tainted', type: 'claim', text: 'no', source_type: 'call', approved: true, untrusted: true },
  ];
  withHome(mixed, () => {
    const rows = pk.readApproved();
    assert.deepEqual(rows.map(r => r.id), ['good'], 'only the clean approved row survives');
  });
});

test('appendCandidate forces approved:false + untrusted:true even if a caller passes approved:true', () => {
  withHome(null, () => {
    const stored = pk.appendCandidate({ id: 'C1', type: 'pain', role: 'payroll', text: 'mined pain', source_type: 'call', approved: true, untrusted: false });
    assert.equal(stored.approved, false);
    assert.equal(stored.untrusted, true);
    const back = pk.readCandidates();
    assert.equal(back.length, 1);
    assert.equal(back[0].id, 'C1');
    assert.equal(back[0].untrusted, true);
  });
});

test('resolveRole maps titles via the committed vocab and falls back to general', () => {
  assert.equal(pk.resolveRole('Chief Financial Officer'), 'finance');
  assert.equal(pk.resolveRole('Payroll Manager'), 'payroll');
  assert.equal(pk.resolveRole('Store Manager'), 'operations');
  assert.equal(pk.resolveRole('Managing Director'), 'owner');
  assert.equal(pk.resolveRole('Head of People & Culture'), 'hr');
  assert.equal(pk.resolveRole(''), 'general');
  assert.equal(pk.resolveRole('Astronaut'), 'general', 'unknown title -> general (never a crash)');
  assert.equal(pk.resolveRole(null), 'general');
});

test('validateVocabTags rejects free-text role/segment/competitor', () => {
  assert.equal(pk.validateVocabTags({ role: 'finance', segment: 'hospitality, retail', competitor: 'deputy' }).ok, true);
  assert.equal(pk.validateVocabTags({ role: 'wizard' }).ok, false);
  assert.equal(pk.validateVocabTags({ segment: 'narnia' }).ok, false);
  assert.equal(pk.validateVocabTags({ competitor: 'acme-corp' }).ok, false);
});

test('backward compatible: an industry-only query returns the segment entry, legacy entries retrieve unchanged', () => {
  const legacyOnly = [
    { id: 'PK-03', type: 'use-case', text: 'demand -> staff counts', segment: 'hospitality, retail', source_title: 't', source_url: 'u', source_type: 'public', approved: true, approved_by: 'Lucas', last_verified: FRESH, guardrail: 'g' },
    { id: 'PK-01', type: 'value-prop', text: 'roster agent', segment: 'general', source_title: 't', source_url: 'u', source_type: 'public', approved: true, approved_by: 'Lucas', last_verified: FRESH, guardrail: 'g' },
  ];
  withHome(legacyOnly, () => {
    const r = pk.retrieve({ segment: 'hospitality' }, { now: NOW, logGap: false });
    assert.ok(r.found);
    assert.equal(r.tier, 'segment');
    assert.deepEqual(ids(r), ['PK-03']);
  });
});
