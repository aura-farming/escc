'use strict';

/*
 * Tests for the voice-overlay downgrade guard + backup (v1.9.0, ADR-0019).
 *
 * writeOverlay is a wholesale overwrite, so a standing refresh from a thin
 * thread must NOT replace a high-confidence overlay with a low-confidence one.
 * The guard skips the write when the new register has fewer samples than the
 * stored overlay (unless force). Before any real overwrite the prior overlay is
 * backed up to <file>.bak.
 *
 * Hermetic: ESCC_AGENT_DATA_HOME points at a tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const overlay = require('../../scripts/lib/voice-overlay');

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) process.env[k] = overrides[k];
  try {
    return fn();
  } finally {
    for (const k of Object.keys(overrides)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function freshHome() {
  return { ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-vog-')) };
}

const rich = { formality: 'formal', avgSentenceLength: 18, questionRate: 0.1, lexicon: ['invoicing', 'rollout'], sampleCount: 8, confidence: 'high' };
const thin = { formality: 'casual', avgSentenceLength: 6, questionRate: 0.5, lexicon: ['hey'], sampleCount: 2, confidence: 'low' };

test('a thinner refresh does not downgrade a higher-confidence overlay', () => {
  withEnv(freshHome(), () => {
    overlay.writeOverlay('company:1', rich);
    assert.equal(overlay.overlaySampleCount('company:1'), 8);

    overlay.writeOverlay('company:1', thin); // fewer samples -> skipped
    assert.equal(overlay.overlaySampleCount('company:1'), 8, 'stored overlay preserved');
    assert.ok(/formal/.test(overlay.readOverlay('company:1')), 'the richer register survives');
  });
});

test('--force overwrites even with fewer samples, backing up the prior overlay', () => {
  withEnv(freshHome(), () => {
    const file = overlay.writeOverlay('company:1', rich);
    overlay.writeOverlay('company:1', thin, { force: true });
    assert.equal(overlay.overlaySampleCount('company:1'), 2, 'forced overwrite took effect');
    assert.ok(fs.existsSync(`${file}.bak`), 'prior overlay backed up');
    assert.ok(/formal/.test(fs.readFileSync(`${file}.bak`, 'utf8')), 'the .bak holds the pre-overwrite register');
  });
});

test('a richer refresh overwrites freely and backs up the prior overlay', () => {
  withEnv(freshHome(), () => {
    const file = overlay.writeOverlay('company:1', thin);
    overlay.writeOverlay('company:1', rich); // more samples -> writes
    assert.equal(overlay.overlaySampleCount('company:1'), 8);
    assert.ok(fs.existsSync(`${file}.bak`), 'prior (thin) overlay backed up before overwrite');
  });
});

test('first-ever write always lands (no stored overlay to protect)', () => {
  withEnv(freshHome(), () => {
    overlay.writeOverlay('company:9', thin);
    assert.equal(overlay.overlaySampleCount('company:9'), 2);
  });
});
