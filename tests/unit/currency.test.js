'use strict';

/*
 * Tests for scripts/lib/currency.js (v1.8.0 blocker fix): mixed-currency math
 * must refuse-by-default, convert with provenance when configured, and never
 * silently mix units. Hermetic temp homes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const currency = require('../../scripts/lib/currency');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-currency-'));
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return fn(); } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function seedLocale(home) {
  const p = path.join(home, 'escc', 'config', 'locale.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    reporting_currency: 'USD',
    fx: { AUD: { rate: 0.66, as_of: '2026-07-01', source: 'test' } },
  }));
}

test('no locale config -> cross-currency math REFUSES (safe default)', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const r = currency.normalizeAmount(1000, 'AUD');
    assert.equal(r.value, null);
    assert.match(r.error, /no workspace reporting currency/);
  });
});

test('same-currency passthrough; conversion carries rate + as-of provenance', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    seedLocale(home);
    const same = currency.normalizeAmount(500, 'usd');
    assert.deepEqual(same, { value: 500, currency: 'USD', converted: false });
    const conv = currency.normalizeAmount(1000, 'AUD');
    assert.equal(conv.value, 660);
    assert.equal(conv.currency, 'USD');
    assert.equal(conv.rate, 0.66);
    assert.equal(conv.rateAsOf, '2026-07-01');
    const missing = currency.normalizeAmount(1000, 'EUR');
    assert.equal(missing.value, null);
    assert.match(missing.error, /no FX rate for EUR/);
  });
});

test('sumAmounts never silently mixes: unconvertibles land in skipped, not the total', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    seedLocale(home);
    const r = currency.sumAmounts([
      { id: 'd1', amount: 100000, currency: 'USD' },
      { id: 'd2', amount: 100000, currency: 'AUD' },
      { id: 'd3', amount: 50000, currency: 'EUR' },   // no rate
      { id: 'd4', amount: 25000 },                    // no currency code
    ]);
    assert.equal(r.total, 166000, 'USD 100k + AUD 100k @0.66');
    assert.equal(r.currency, 'USD');
    assert.equal(r.counted, 2);
    assert.equal(r.skipped.length, 2);
    assert.ok(r.skipped.some(s => s.id === 'd3' && /no FX rate/.test(s.reason)));
    assert.ok(r.skipped.some(s => s.id === 'd4' && /no currency code/.test(s.reason)));
    assert.deepEqual(r.ratesUsed.AUD, { rate: 0.66, as_of: '2026-07-01' });
  });
});

test('initWorkspaceLocale copies the shipped template once', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const first = currency.initWorkspaceLocale();
    assert.equal(first.created, true);
    assert.ok(fs.existsSync(first.path));
    assert.equal(currency.initWorkspaceLocale().created, false, 'never clobbers an existing config');
    const loaded = currency.loadLocale();
    assert.equal(loaded.reportingCurrency, 'USD');
    assert.ok(loaded.fx.AUD, 'template FX entries load');
  });
});
