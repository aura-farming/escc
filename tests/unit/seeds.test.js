'use strict';

/*
 * Tests for the shipped seed instincts (spec §5.6 ten + A.8/I8 eight = 18).
 *
 * Seeds ship as ONE frontmatter-.md file per instinct under
 * .claude/escc/instincts/inherited/ — the directory + format the live runtime
 * actually reads (session-start.js instinctDirs()/parseInstinct). The spec's
 * literal "single escc-instincts.yaml with 10 instincts" is incompatible with
 * that parser (it reads one frontmatter block + one ## Action per file), so the
 * runtime contract wins. These tests prove the shipped artifacts:
 *   - are exactly the 18 expected ids, one file each (filename == id);
 *   - parse + validate against schemas/instinct.schema.json (the store parser);
 *   - are all scope:team + decay_exempt (I8) with in-range confidence + enum domain;
 *   - carry the exact §5.6 base confidences;
 *   - are read correctly by the LIVE session-start parser; and
 *   - actually inject through the real C7 loader (buildInstinctsBlock).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../../scripts/instincts/instinct-store.js');
const sessionStart = require('../../scripts/hooks/session-start.js');

const SEED_DIR = path.join(__dirname, '..', '..', '.claude', 'escc', 'instincts', 'inherited');

function seedIds() {
  return fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort();
}
function readSeed(id) {
  return fs.readFileSync(path.join(SEED_DIR, `${id}.md`), 'utf8');
}

const EXPECTED_IDS = [
  // 10 base (§5.6)
  'draft-before-send', 'verify-sent-before-claiming', 'unsubscribe-and-identity-on-sequences',
  'log-activity-after-meeting', 'next-step-on-every-open-deal', 'no-bulk-without-review-pack',
  'personalization-evidence-before-outreach', 'read-thread-before-reply',
  'meddpicc-gap-check-before-forecast', 'quarantine-prospect-attachments',
  // 8 A.8 (I8)
  'speed-to-lead-within-sla', 'multi-thread-before-close', 'one-cta-per-outreach',
  'confirm-meeting-before-meeting', 'no-show-recovery', 'no-tos-violating-scraping',
  'suppression-check-before-sequence-add', 'log-call-disposition-after-dial',
].sort();

// §5.6 base seed confidences (exact).
const BASE_CONFIDENCE = {
  'draft-before-send': 0.9,
  'verify-sent-before-claiming': 0.9,
  'unsubscribe-and-identity-on-sequences': 0.9,
  'log-activity-after-meeting': 0.85,
  'next-step-on-every-open-deal': 0.85,
  'no-bulk-without-review-pack': 0.85,
  'personalization-evidence-before-outreach': 0.8,
  'read-thread-before-reply': 0.8,
  'meddpicc-gap-check-before-forecast': 0.7,
  'quarantine-prospect-attachments': 0.7,
};

const DOMAINS = ['outreach', 'deals', 'process', 'crm', 'preferences'];

test('seeds: exactly the 18 expected seed instinct files (filename == id)', () => {
  const ids = seedIds();
  assert.equal(ids.length, 18, `expected 18 seed files, got ${ids.length}: ${ids.join(', ')}`);
  assert.deepEqual(ids, EXPECTED_IDS, 'seed id set does not match the spec §5.6 + A.8 list');
});

test('seeds: every file parses and validates against instinct.schema.json', () => {
  for (const id of seedIds()) {
    const parsed = store.parseInstinct(readSeed(id));
    assert.equal(parsed.id, id, `frontmatter id must equal filename for ${id}.md`);
    const { valid, errors } = store.validateInstinct(parsed);
    assert.ok(valid, `${id}.md is schema-invalid: ${JSON.stringify(errors)}`);
  }
});

test('seeds: all are scope:team + decay_exempt (I8), in-range confidence, enum domain', () => {
  for (const id of seedIds()) {
    const p = store.parseInstinct(readSeed(id));
    assert.equal(p.scope, 'team', `${id} must be scope:team (I8)`);
    assert.equal(p.decay_exempt, true, `${id} must be decay_exempt (I8)`);
    assert.ok(typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1, `${id} confidence out of range`);
    assert.ok(DOMAINS.includes(p.domain), `${id} domain '${p.domain}' not in enum`);
    assert.ok(p.trigger && p.action, `${id} must carry a trigger and an action`);
  }
});

test('seeds: §5.6 base seeds carry their exact confidences', () => {
  for (const [id, conf] of Object.entries(BASE_CONFIDENCE)) {
    const p = store.parseInstinct(readSeed(id));
    assert.equal(p.confidence, conf, `${id} confidence should be ${conf}`);
  }
});

test('seeds: the live session-start parser reads id/confidence/action from each', () => {
  for (const id of seedIds()) {
    const p = sessionStart.parseInstinct(readSeed(id));
    assert.ok(p.id, `${id}: session-start parser produced no id`);
    assert.ok(p.action, `${id}: session-start parser produced no action (would be dropped from injection)`);
    assert.ok(Number.isFinite(p.confidence), `${id}: session-start parser produced no numeric confidence`);
  }
});

test('seeds: inject through the real C7 loader (buildInstinctsBlock via ESCC_INSTINCTS_DIR)', () => {
  const saved = {
    ESCC_INSTINCTS_DIR: process.env.ESCC_INSTINCTS_DIR,
    ESCC_AGENT_DATA_HOME: process.env.ESCC_AGENT_DATA_HOME,
    ESCC_INSTINCT_HOME: process.env.ESCC_INSTINCT_HOME,
  };
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-seeds-'));
  try {
    process.env.ESCC_INSTINCTS_DIR = SEED_DIR;     // the shipped seeds
    process.env.ESCC_AGENT_DATA_HOME = emptyHome;  // no personal/inherited contamination
    process.env.ESCC_INSTINCT_HOME = emptyHome;    // no engine-store contamination
    const block = sessionStart.buildInstinctsBlock('enterprise');
    assert.ok(block.startsWith('Active instincts:'), `expected an injected instincts block, got: ${JSON.stringify(block)}`);
    // draft-before-send (0.9) is highest-confidence and must survive the C7 top-N budget.
    assert.ok(block.includes('Create a draft and review it'), 'top seed (draft-before-send) should inject');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
