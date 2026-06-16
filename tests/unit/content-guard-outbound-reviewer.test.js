'use strict';

/*
 * Content guard: the outbound-reviewer agent must keep its confidence gate.
 *
 * The reviewer's value is precision — it reports only findings it is >80%
 * confident are real, and a clean review is a valid outcome (it must not invent
 * low-confidence nits to look thorough). This guard pins that contract in the
 * agent's text so a future edit cannot quietly remove it.
 */

const fs = require('fs');
const path = require('path');

const REVIEWER = path.join(__dirname, '..', '..', 'agents', 'outbound-reviewer.md');
const content = fs.existsSync(REVIEWER) ? fs.readFileSync(REVIEWER, 'utf8') : '';

test('content-guard: agents/outbound-reviewer.md exists and is non-empty', () => {
  assert.ok(content.trim().length > 0, 'agents/outbound-reviewer.md must exist and be non-empty');
});

test('content-guard: outbound-reviewer enforces the >80% confidence gate', () => {
  assert.ok(
    /more than 80%|>\s?80%/i.test(content),
    'outbound-reviewer must state the >80%-confidence reporting gate'
  );
});

test('content-guard: outbound-reviewer treats a clean review as a valid outcome', () => {
  assert.ok(
    /clean review is a valid/i.test(content),
    'outbound-reviewer must state that a clean review is a valid outcome (no invented nits)'
  );
});

test('content-guard: outbound-reviewer is read-only and never sends', () => {
  assert.ok(/READ-ONLY/.test(content), 'outbound-reviewer must declare it is READ-ONLY');
  assert.ok(/never send/i.test(content), 'outbound-reviewer must state it never sends');
});
