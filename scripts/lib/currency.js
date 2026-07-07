/*
 * ESCC currency correctness (NEW for ESCC; v1.8.0 blocker fix).
 *
 * A multi-region forecast that sums AUD, USD, and EUR amounts as if they were
 * the same unit produces an authoritative-looking FALSEHOOD — worse than no
 * number for a source-of-truth system. This module makes mixed-currency math
 * refuse-by-default:
 *
 *   - amounts carry a currency code; the workspace declares a REPORTING
 *     currency and an FX table (rate + as-of date + source — rates are
 *     themselves stale-able provenance, like product-knowledge claims);
 *   - normalizeAmount converts with provenance, and returns an ERROR rather
 *     than a guess when no rate exists;
 *   - sumAmounts refuses to fold mixed currencies silently: anything it
 *     cannot normalize lands in `skipped`, never in the total.
 *
 * Workspace config: <data-home>/escc/config/locale.json (runtime, per-team,
 * survives plugin updates). config/locale.example.json ships the template.
 * rules/common/forecasting-definitions.md owns the policy.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveAgentDataHome } = require('./agent-data-home');

const LOCALE_RELATIVE = path.join('escc', 'config', 'locale.json');

function workspaceLocalePath(options = {}) {
  return path.join(resolveAgentDataHome(options), LOCALE_RELATIVE);
}

/**
 * Load the workspace locale config. Missing/invalid -> { reportingCurrency:
 * null, fx: {} } — which makes all cross-currency math refuse, the safe default.
 */
function loadLocale(options = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(workspaceLocalePath(options), 'utf8'));
    return {
      reportingCurrency: parsed.reporting_currency ? String(parsed.reporting_currency).toUpperCase() : null,
      fx: parsed.fx && typeof parsed.fx === 'object' ? parsed.fx : {},
    };
  } catch (_err) {
    return { reportingCurrency: null, fx: {} };
  }
}

/** Copy the shipped template into the workspace (returns false if present). */
function initWorkspaceLocale(options = {}) {
  const dest = workspaceLocalePath(options);
  if (fs.existsSync(dest) && !options.force) return { created: false, path: dest };
  const template = path.join(options.repoRoot || path.resolve(__dirname, '..', '..'), 'config', 'locale.example.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(template, dest);
  return { created: true, path: dest };
}

/**
 * Normalize one amount into the reporting currency, with provenance.
 * @param {number} amount
 * @param {string} currency ISO code the amount is denominated in
 * @param {{locale?:object}} [options]
 * @returns {{value:number|null, currency:string|null, rate?:number,
 *   rateAsOf?:string, converted:boolean, error?:string}}
 */
function normalizeAmount(amount, currency, options = {}) {
  const locale = options.locale || loadLocale(options);
  const from = String(currency || '').toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) return { value: null, currency: null, converted: false, error: 'amount is not a number' };
  if (!from) return { value: null, currency: null, converted: false, error: 'amount carries no currency code' };
  if (!locale.reportingCurrency) {
    return { value: null, currency: from, converted: false, error: 'no workspace reporting currency configured (escc/config/locale.json)' };
  }
  if (from === locale.reportingCurrency) {
    return { value: n, currency: from, converted: false };
  }
  const entry = locale.fx[from];
  const rate = entry && Number(entry.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { value: null, currency: from, converted: false, error: `no FX rate for ${from} -> ${locale.reportingCurrency} in the workspace locale config` };
  }
  return {
    value: Math.round(n * rate * 100) / 100,
    currency: locale.reportingCurrency,
    rate,
    rateAsOf: entry.as_of || entry.asOf || null,
    converted: true,
  };
}

/**
 * Sum amounts REFUSING silent mixed-currency folds: every item either
 * normalizes into the reporting currency or lands in `skipped` with a reason.
 * @param {Array<{amount:number, currency:string, id?:string}>} items
 * @returns {{total:number, currency:string|null, counted:number,
 *   skipped:Array<{id, amount, currency, reason}>, ratesUsed:object}}
 */
function sumAmounts(items, options = {}) {
  const locale = options.locale || loadLocale(options);
  let total = 0;
  let counted = 0;
  const skipped = [];
  const ratesUsed = {};
  for (const item of Array.isArray(items) ? items : []) {
    const r = normalizeAmount(item.amount, item.currency, { locale });
    if (r.value == null) {
      skipped.push({ id: item.id || null, amount: item.amount, currency: item.currency || null, reason: r.error });
      continue;
    }
    total += r.value;
    counted += 1;
    if (r.converted) ratesUsed[String(item.currency).toUpperCase()] = { rate: r.rate, as_of: r.rateAsOf };
  }
  return {
    total: Math.round(total * 100) / 100,
    currency: locale.reportingCurrency,
    counted,
    skipped,
    ratesUsed,
  };
}

module.exports = { workspaceLocalePath, loadLocale, initWorkspaceLocale, normalizeAmount, sumAmounts };
