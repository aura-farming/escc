'use strict';

/*
 * Tests for scripts/lib/promise-extract — detects rep commitments ("I'll follow
 * up …", "I will send the proposal by Friday") in plain conversation text and
 * turns them into first-class promise records (A.2 C3). Pure + deterministic:
 * relative due dates resolve against an injected `now`.
 */

const pe = require('../../scripts/lib/promise-extract');

const NOW = '2026-06-15T00:00:00.000Z'; // a Monday

test('detects a follow-up commitment and ignores ordinary sentences', () => {
  const text = [
    'The prospect asked about pricing.',
    "I'll follow up with the security questionnaire next week.",
    'They use Salesforce today.',
  ].join('\n');
  const promises = pe.extractPromises(text, { now: NOW });
  assert.equal(promises.length, 1, 'exactly one commitment detected');
  assert.ok(/follow up/i.test(promises[0].text));
});

test('resolves an explicit ISO due date', () => {
  const promises = pe.extractPromises("I'll send the MSA by 2026-06-20.", { now: NOW });
  assert.equal(promises.length, 1);
  assert.equal(promises[0].due_date, '2026-06-20');
});

test('resolves "tomorrow" relative to the injected now', () => {
  const promises = pe.extractPromises("I'll circle back tomorrow with the deck.", { now: NOW });
  assert.equal(promises[0].due_date, '2026-06-16');
});

test('attaches account/deal/session and yields a stable, account-scoped id', () => {
  const ctx = { now: NOW, accountId: 'example-co', dealId: 'deal-1', sessionId: 'sess-9' };
  const [p] = pe.extractPromises("I'll send the proposal.", ctx);
  assert.equal(p.account_id, 'example-co');
  assert.equal(p.deal_id, 'deal-1');
  assert.equal(p.source_session, 'sess-9');
  assert.equal(p.status, 'open');

  // Same text + same account => same id (idempotent upsert across SessionEnd runs).
  const [again] = pe.extractPromises("I'll send the proposal.", { ...ctx, sessionId: 'sess-DIFFERENT' });
  assert.equal(p.id, again.id, 'id is stable across sessions for the same account+text');

  // Different account => different id (per-account attribution, C8 multi-account).
  const [other] = pe.extractPromises("I'll send the proposal.", { ...ctx, accountId: 'sample-co' });
  assert.notEqual(p.id, other.id);
});

test('dedupes repeated commitments within one transcript', () => {
  const text = "I'll follow up Thursday.\nLater: I'll follow up Thursday.";
  const promises = pe.extractPromises(text, { now: NOW, accountId: 'example-co' });
  assert.equal(promises.length, 1, 'identical commitments collapse to one record');
});

test('returns [] for text with no commitments', () => {
  assert.deepEqual(pe.extractPromises('Just some notes about the account.', { now: NOW }), []);
});

test('ignores a structurally-valid but impossible ISO date', () => {
  const [p] = pe.extractPromises("I'll send it by 2026-13-45.", { now: NOW });
  assert.ok(p, 'still detected as a commitment');
  assert.equal(p.due_date, null, 'an impossible date never becomes a due_date');
});
