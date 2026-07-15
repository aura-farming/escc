'use strict';

/*
 * Unit tests for scripts/lib/product-knowledge.js — the retrieval ladder, vocab
 * resolution/validation, candidate ingest, freshness, gap logging, and the
 * workspace-override vocab layer (ADR-0012 + v1.3.0 generic-vocab work).
 *
 * Hermetic, mirroring tests/unit/account-memory.test.js: each case runs against a
 * fresh ESCC_AGENT_DATA_HOME temp dir and a deterministic `now`. Tests the THREAT
 * (approved-only, fresh-only, candidate forced-flags, never-throws), not just the
 * happy path. Fixtures use neutral, cross-industry labels (no company-specific
 * vocabulary) so the suite stays company-neutral.
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
  { id: 'A', type: 'value-prop', text: 'finance manufacturing', segment: 'manufacturing, wholesale', role: 'finance', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'B', type: 'value-prop', text: 'general proof', segment: 'general', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'F', type: 'value-prop', text: 'industry manufacturing, untagged role', segment: 'manufacturing', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'BC', type: 'battlecard', competitor: 'competitor-x', role: 'owner', segment: 'general', differentiation: 'built-in automation', guardrail: 'differentiation only', text: 'vs competitor-x', source_type: 'public', approved: true, last_verified: FRESH },
  { id: 'OLD', type: 'value-prop', text: 'logistics, stale', segment: 'logistics', source_type: 'public', approved: true, last_verified: STALE },
];

const ids = r => r.entries.map(e => e.id);

test('ladder: most-specific role+segment match wins over general', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'finance', segment: 'manufacturing' }, { now: NOW, logGap: false });
    assert.ok(r.found, 'should find a match');
    assert.equal(r.tier, 'role+segment');
    assert.deepEqual(ids(r), ['A']);
  });
});

test('ladder: a role with no entries falls back to the industry (segment) entry', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'hr', segment: 'manufacturing' }, { now: NOW, logGap: false });
    assert.ok(r.found);
    assert.equal(r.tier, 'segment');
    assert.deepEqual(ids(r), ['F'], 'finance (A) is a different role and must not surface; untagged manufacturing (F) does');
  });
});

test('ladder: competitor battlecard returns the most specific tier and carries its guardrail', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'owner', segment: 'general', competitor: 'competitor-x', type: 'battlecard' }, { now: NOW, logGap: false });
    assert.ok(r.found);
    assert.equal(r.tier, 'role+segment+competitor');
    assert.deepEqual(ids(r), ['BC']);
    assert.ok(r.entries[0].guardrail, 'battlecard entry must carry a guardrail');
  });
});

test('ladder: clean miss returns the no-proof sentinel and logs a gap', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ role: 'finance', segment: 'logistics', type: 'objection' }, { now: NOW });
    assert.equal(r.found, false);
    assert.ok(/^no approved proof for /.test(r.sentinel), r.sentinel);
    const gaps = pk.readGaps();
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].role, 'finance');
    assert.equal(gaps[0].segment, 'logistics');
    assert.equal(gaps[0].type, 'objection');
  });
});

test('freshness: a stale entry is excluded from entries and flagged in stale', () => {
  withHome(STORE, () => {
    const r = pk.retrieve({ segment: 'logistics' }, { now: NOW, logGap: false });
    assert.ok(!ids(r).includes('OLD'), 'stale entry must not be quotable');
    assert.ok(r.stale.some(e => e.id === 'OLD'), 'stale entry must be flagged as a hypothesis');
  });
});

test('retrieve never throws when the store is missing', () => {
  withHome(null, () => {
    const r = pk.retrieve({ role: 'finance', segment: 'manufacturing' }, { now: NOW, logGap: false });
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
    const stored = pk.appendCandidate({ id: 'C1', type: 'pain', role: 'finance', text: 'mined pain', source_type: 'call', approved: true, untrusted: false });
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
  assert.equal(pk.resolveRole('Chief Technology Officer'), 'it');
  assert.equal(pk.resolveRole('Store Manager'), 'operations');
  assert.equal(pk.resolveRole('Managing Director'), 'owner');
  assert.equal(pk.resolveRole('Head of People & Culture'), 'hr');
  assert.equal(pk.resolveRole('VP of Procurement'), 'procurement');
  assert.equal(pk.resolveRole(''), 'general');
  assert.equal(pk.resolveRole('Astronaut'), 'general', 'unknown title -> general (never a crash)');
  assert.equal(pk.resolveRole(null), 'general');
});

test('validateVocabTags rejects free-text role/segment/competitor', () => {
  // The positive case uses an injected vocab fixture so it is decoupled from the
  // shipped generic template (which carries no competitors/segments by default).
  const vocab = { version: 1, roles: ['general', 'finance'], segments: ['general', 'manufacturing', 'wholesale'], competitors: ['competitor-x'], title_to_role: [], fallback_role: 'general' };
  assert.equal(pk.validateVocabTags({ role: 'finance', segment: 'manufacturing, wholesale', competitor: 'competitor-x' }, { vocab }).ok, true);
  assert.equal(pk.validateVocabTags({ role: 'wizard' }, { vocab }).ok, false);
  assert.equal(pk.validateVocabTags({ segment: 'narnia' }, { vocab }).ok, false);
  assert.equal(pk.validateVocabTags({ competitor: 'example-co' }, { vocab }).ok, false);
});

test('backward compatible: an industry-only query returns the segment entry, legacy entries retrieve unchanged', () => {
  const legacyOnly = [
    { id: 'PK-03', type: 'use-case', text: 'demand -> staff counts', segment: 'manufacturing, wholesale', source_title: 't', source_url: 'u', source_type: 'public', approved: true, approved_by: 'Example Operator', last_verified: FRESH, guardrail: 'g' },
    { id: 'PK-01', type: 'value-prop', text: 'general value prop', segment: 'general', source_title: 't', source_url: 'u', source_type: 'public', approved: true, approved_by: 'Example Operator', last_verified: FRESH, guardrail: 'g' },
  ];
  withHome(legacyOnly, () => {
    const r = pk.retrieve({ segment: 'manufacturing' }, { now: NOW, logGap: false });
    assert.ok(r.found);
    assert.equal(r.tier, 'segment');
    assert.deepEqual(ids(r), ['PK-03']);
  });
});

// --- workspace-override vocab layer (v1.3.0) --------------------------------

test('loadVocab precedence: workspace override beats shipped template; options win over workspace', () => {
  withHome(null, (home) => {
    // No workspace override yet -> the shipped generic template.
    assert.equal(pk.vocabSource(), 'shipped');
    assert.ok(pk.loadVocab().roles.includes('general'), 'shipped template loads');
    // Write a workspace override -> it wins over the shipped template.
    const dir = path.join(home, 'escc', 'product');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'knowledge-vocab.json'), JSON.stringify({ version: 9, roles: ['general', 'captain'], segments: ['general'], competitors: [], title_to_role: [], fallback_role: 'general' }));
    assert.equal(pk.vocabSource(), 'workspace');
    assert.ok(pk.loadVocab().roles.includes('captain'), 'workspace override is used');
    // An inline vocab and an explicit vocabPath both beat the workspace override.
    assert.equal(pk.vocabSource({ vocab: { roles: ['x'] } }), 'inline');
    const vp = path.join(home, 'vp.json');
    fs.writeFileSync(vp, JSON.stringify({ version: 1, roles: ['general'], segments: ['general'], competitors: [], title_to_role: [], fallback_role: 'general' }));
    assert.equal(pk.vocabSource({ vocabPath: vp }), 'vocabPath');
  });
});

test('initWorkspaceVocab creates the override from the template, refuses to clobber without force', () => {
  withHome(null, () => {
    const r1 = pk.initWorkspaceVocab(false);
    assert.ok(r1.created, 'created on first run');
    assert.ok(fs.existsSync(r1.path));
    const written = JSON.parse(fs.readFileSync(r1.path, 'utf8'));
    assert.ok(Array.isArray(written.roles) && written.roles.includes('general'));
    const r2 = pk.initWorkspaceVocab(false);
    assert.equal(r2.created, false, 'does not clobber without force');
    assert.equal(r2.reason, 'exists');
    assert.ok(pk.initWorkspaceVocab(true).created, 'force overwrites');
  });
});

test('suggestSegments slugifies, de-dupes, and drops empties + general', () => {
  const { suggested } = pk.suggestSegments(['Field Services', 'field services', 'General', '', 'Oil & Gas']);
  assert.deepEqual(suggested, ['field-services', 'oil-gas']);
  assert.deepEqual(pk.suggestSegments('Health Care, Health Care, general').suggested, ['health-care']);
  assert.equal(pk.slugifySegment('  Multi-Site!! '), 'multi-site');
});

test('addSegmentsToWorkspace unions new slugs into the override (creating it if absent)', () => {
  withHome(null, () => {
    const r = pk.addSegmentsToWorkspace(['Field Services', 'general', 'field services']);
    assert.deepEqual(r.added, ['field-services'], 'dedupes and drops general');
    const vocab = JSON.parse(fs.readFileSync(r.path, 'utf8'));
    assert.ok(vocab.segments.includes('field-services'));
    assert.ok(vocab.segments.includes('general'), 'template segments preserved');
  });
});
