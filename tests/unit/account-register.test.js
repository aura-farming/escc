'use strict';

/*
 * Tests for scripts/lib/account-register (deterministic per-account STYLE
 * register extractor) and scripts/lib/voice-overlay (its markdown storage).
 * The leak guard — a buyer claim/number can never become a mirrored term — is
 * also pinned harder from the threat side in
 * tests/unit/content-guard-lexicon-leak.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const reg = require('../../scripts/lib/account-register');
const overlay = require('../../scripts/lib/voice-overlay');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-voiceoverlay-'));
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// --- formality classification ----------------------------------------------

test('extractRegister classifies a formal register', () => {
  const r = reg.extractRegister(
    'Dear Jordan, Thank you for your email. I would be grateful if you could send the proposal. Kind regards, Morgan.'
  );
  assert.equal(r.formality, 'formal');
  assert.equal(r.greeting, 'dear');
  assert.equal(r.signOff, 'kind regards');
});

test('extractRegister classifies a casual register', () => {
  const r = reg.extractRegister("Hey! Thanks so much, this is awesome. We're keen to chat — can't wait. Cheers, Sam");
  assert.equal(r.formality, 'casual');
  assert.equal(r.greeting, 'hey');
  assert.equal(r.signOff, 'cheers');
});

test('extractRegister falls to neutral when there are no formal or casual cues', () => {
  const r = reg.extractRegister('We reviewed the document. The integration covers invoicing and reporting.');
  assert.equal(r.formality, 'neutral');
});

// --- sentence-length, question rate ----------------------------------------

test('extractRegister computes average sentence length in words', () => {
  assert.equal(reg.extractRegister('One two three four five.').avgSentenceLength, 5);
});

test('extractRegister computes question rate over sentences', () => {
  const r = reg.extractRegister('Are you free Thursday? I can do 2pm. Does that work?');
  assert.equal(r.questionRate, 0.67); // 2 of 3 sentences are questions
});

// --- lexicon + the leak guard ----------------------------------------------

test('lexicon surfaces recurring content terms and drops stopwords', () => {
  const r = reg.extractRegister([
    'Invoicing accuracy is the priority. Invoicing drives everything.',
    'The rollout of invoicing and reporting starts soon.',
  ]);
  assert.ok(r.lexicon.includes('invoicing'), 'recurring buyer term surfaces');
  assert.equal(r.lexicon[0], 'invoicing', 'most frequent term ranks first');
  assert.ok(!r.lexicon.includes('the'), 'stopwords excluded');
  assert.ok(!r.lexicon.includes('is'), 'stopwords excluded');
});

test('lexicon can NEVER contain a number, percentage, or currency figure', () => {
  const r = reg.extractRegister([
    'We must cut costs by 47% this year.',
    'We want to save $2.3M on invoicing and reporting.',
    'Headcount is 1200 people across 14 sites.',
  ]);
  for (const term of r.lexicon) {
    assert.ok(!/\d/.test(term), `lexicon term "${term}" must carry no digit`);
  }
  assert.ok(!r.lexicon.includes('47'), 'a percentage figure is not a term');
  assert.ok(r.lexicon.includes('invoicing'), 'the surrounding buyer vocabulary still surfaces');
});

test('maxTerms caps the lexicon length', () => {
  const r = reg.extractRegister('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi.', { maxTerms: 3 });
  assert.equal(r.lexicon.length, 3);
});

// --- input shapes + confidence ---------------------------------------------

test('extractRegister accepts a string, a string[], and a {text}[]', () => {
  assert.equal(reg.extractRegister('Hello there. We love invoicing.').sampleCount, 1);
  assert.equal(reg.extractRegister(['a one.', 'b two.']).sampleCount, 2);
  assert.equal(reg.extractRegister([{ text: 'a.' }, { text: 'b.' }, { no: 'text' }]).sampleCount, 2);
});

test('confidence scales with sample count; empty input is safe', () => {
  assert.equal(reg.extractRegister([]).confidence, 'low');
  assert.equal(reg.extractRegister([]).sampleCount, 0);
  assert.equal(reg.extractRegister(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).confidence, 'high');
});

// --- voice-overlay storage --------------------------------------------------

test('writeOverlay then readOverlay round-trips at the sanitized account path', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const r = reg.extractRegister(['Invoicing matters. Invoicing again.', 'Reporting and invoicing.']);
    const file = overlay.writeOverlay('domain:company.test', r);
    assert.ok(file.endsWith(path.join('escc', 'voice', 'account', 'domain_company.test.md')), `overlay at sanitized path (was ${file})`);
    assert.ok(fs.existsSync(file), 'overlay file written');

    const md = overlay.readOverlay('domain:company.test');
    assert.ok(md.includes('# Account voice overlay: domain:company.test'));
    assert.ok(md.includes('Formality:'));
    assert.ok(md.includes('invoicing'), 'mirrored lexicon term present');
    assert.ok(/STYLE OVERLAY ONLY/.test(md), 'overlay states the style-only rule');
  });
});

test('readOverlay returns empty string for a missing or unusable account', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    assert.equal(overlay.readOverlay('never-seen'), '');
    assert.equal(overlay.readOverlay(''), '');
  });
});

test('voiceOverlayFile throws on an unusable account id', () => {
  assert.throws(() => overlay.voiceOverlayFile(''));
  assert.throws(() => overlay.voiceOverlayFile(null));
});
