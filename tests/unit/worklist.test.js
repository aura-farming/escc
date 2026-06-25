'use strict';

/**
 * Tests for the batch review-pack builder (scripts/lib/worklist.js): a small
 * worklist runs through the four gates and is split into a correct
 * sendable/excluded set. Pure — no env, no state store (it writes no tokens).
 */

const { buildReviewPack } = require('../../scripts/lib/worklist');

test('buildReviewPack splits a worklist into sendable vs excluded with reasons', () => {
  const items = [
    { id: 'good', draft: { to: 'a@b.com', subject: 'Hi', body: 'You could cut overtime across your venues — worth a quick look?' }, records: { notes: [], open_deals: [], priorEngagement: false } },
    { id: 'open-deal', draft: { to: 'c@d.com', subject: 'Hi', body: 'You could save hours — keen?' }, records: { open_deals: [{ id: '1' }] } },
    { id: 'wiifm', draft: { to: 'e@f.com', subject: 'Hi', body: "Here's a Acme vs competitor-x comparison." }, records: { priorEngagement: false } },
  ];
  const pack = buildReviewPack(items, { now: '2026-06-23' });
  assert.equal(pack.total, 3);
  assert.equal(pack.sendableCount, 1);
  assert.equal(pack.excludedCount, 2);
  assert.equal(pack.sendable[0].id, 'good');
  assert.deepEqual(pack.excluded.map(e => e.id).sort(), ['open-deal', 'wiifm']);
  const wiifm = pack.excluded.find(e => e.id === 'wiifm');
  assert.ok(wiifm.reasons.some(r => /wiifm/i.test(r)), 'excluded items carry their gate reasons');
});

test('buildReviewPack handles an empty worklist', () => {
  const pack = buildReviewPack([], {});
  assert.equal(pack.total, 0);
  assert.equal(pack.sendableCount, 0);
  assert.equal(pack.excludedCount, 0);
});

test('buildReviewPack never throws on a malformed item', () => {
  const pack = buildReviewPack([null, { id: 'ok', draft: { to: 'a@b.com', subject: 'Hi', body: 'You could save hours.' }, records: {} }], { now: '2026-06-23' });
  assert.equal(pack.total, 2);
  assert.ok(pack.sendable.find(s => s.id === 'ok'), 'the well-formed item is still evaluated');
});
