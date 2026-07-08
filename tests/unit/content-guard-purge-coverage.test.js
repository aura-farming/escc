'use strict';

/*
 * Content-guard: purge coverage doctrine (ADR-0019, D1).
 *
 * The privacy-purge erasure guarantee ("purge deletes the subject cluster-wide")
 * is only as complete as the set of stores it reaches. Every JSONL table ESCC
 * owns must therefore declare a purge strategy in privacy-purge.PURGE_STRATEGIES,
 * so a future table cannot silently escape erasure and reintroduce a privacy
 * regression. This test fails the build the moment a new state-store table is
 * added without a declared strategy.
 *
 * Strategy semantics:
 *   auto:true  -> rewritten in place on --confirm (account key + JSON substring)
 *   auto:false -> no per-subject identifier, or an aggregate that would over-erase
 *                 unrelated subjects (scanned + reported for manual review)
 * Either way the classification is a deliberate, reviewed decision — not silence.
 */

const { TABLE_KEYS } = require('../../scripts/lib/state-store');
const { PURGE_STRATEGIES } = require('../../scripts/lib/privacy-purge');

test('every state-store table declares a purge strategy', () => {
  const undeclared = Object.keys(TABLE_KEYS).filter(t => !(t in PURGE_STRATEGIES));
  assert.deepEqual(
    undeclared,
    [],
    `state-store table(s) missing a PURGE_STRATEGIES entry (add one in privacy-purge.js): ${undeclared.join(', ')}`
  );
});

test('every declared purge strategy has a boolean auto flag and a reason', () => {
  for (const [table, s] of Object.entries(PURGE_STRATEGIES)) {
    assert.equal(typeof s.auto, 'boolean', `${table}: auto must be a boolean`);
    assert.ok(s.reason && s.reason.length > 10, `${table}: reason must explain the strategy`);
  }
});

test('the twin-writer stores the critic flagged are auto-covered', () => {
  // These are the stores every v1.9.0 learning/prep writer lands rows in; they
  // MUST be auto-erased, not merely declared. Regression-locks the D1 fix.
  for (const table of ['outcomes', 'promises', 'work_items']) {
    assert.equal(PURGE_STRATEGIES[table] && PURGE_STRATEGIES[table].auto, true, `${table} must be auto-purged`);
  }
});
