'use strict';

/*
 * Content guard: per-account voice overlays mirror STYLE, never CONTENT
 * (the style/content split, ADR-0013 / ADR-0015).
 *
 * The subtle leak this pins: lexicon-mirroring borrows the buyer's WORDS so a
 * draft sounds like them — but a buyer's CLAIM, metric, percentage, or currency
 * figure must NEVER ride that channel back out as if it were our proof. Facts
 * come only from approved product-knowledge. These assertions prove the wall
 * from the threat side:
 *   1. a planted claim/number in buyer text never reaches the rendered overlay;
 *   2. no lexicon term ever carries a digit;
 *   3. a source sentence is never echoed into the overlay;
 *   4. brand-voice still STATES the split rule + the overlay path in prose.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const reg = require('../../scripts/lib/account-register');
const overlay = require('../../scripts/lib/voice-overlay');

const ROOT = path.join(__dirname, '..', '..');

// Buyer text laced with claims/metrics the overlay must refuse to carry, plus
// recurring neutral vocabulary it SHOULD mirror.
const BUYER_TEXTS = [
  'We will cut invoicing costs by 47% and save $2.3M next year.',
  'Invoicing runs across 1,200 employees and 14 sites; invoicing accuracy is the priority.',
  'The reporting rollout matters more than the price. Reporting and invoicing must align.',
];
const PLANTED = ['47%', '$2.3M', '2.3', '1,200', 'cut invoicing costs by 47'];

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-lexleak-'));
}

test('leak guard: a planted buyer claim/number never reaches the rendered overlay', () => {
  const home = freshHome();
  const prev = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = home;
  try {
    const register = reg.extractRegister(BUYER_TEXTS);
    const file = overlay.writeOverlay('domain:acme.test', register);
    const md = fs.readFileSync(file, 'utf8');

    for (const claim of PLANTED) {
      assert.ok(!md.includes(claim), `overlay must not carry the buyer claim/number "${claim}"`);
    }
    // The buyer's neutral vocabulary IS mirrored — that is the whole point.
    assert.ok(md.includes('invoicing'), 'a neutral recurring buyer term is mirrored');
    assert.ok(/STYLE OVERLAY ONLY/.test(md), 'overlay declares itself style-only');
  } finally {
    if (prev === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prev;
  }
});

test('leak guard: no lexicon term ever carries a digit', () => {
  const register = reg.extractRegister(BUYER_TEXTS);
  assert.ok(register.lexicon.length > 0, 'the lexicon is non-empty for this sample');
  for (const term of register.lexicon) {
    assert.ok(!/\d/.test(term), `lexicon term "${term}" must carry no digit`);
  }
});

test('leak guard: the overlay never echoes a source sentence verbatim', () => {
  const home = freshHome();
  const prev = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = home;
  try {
    const md = overlay.renderOverlay('acme', reg.extractRegister(BUYER_TEXTS));
    for (const sentence of BUYER_TEXTS) {
      assert.ok(!md.includes(sentence), 'no whole buyer sentence is reproduced in the overlay');
    }
  } finally {
    if (prev === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prev;
  }
});

test('split rule: brand-voice states the overlay path and the words-not-claims rule', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'brand-voice', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('voice/account/'), 'brand-voice documents the per-account overlay path');
  assert.ok(skill.includes('claims or numbers'), 'brand-voice restates: mirror words, never claims or numbers');
  assert.ok(skill.includes('Facts and metrics come only from approved'), 'brand-voice keeps facts sourced from approved product-knowledge');
});
