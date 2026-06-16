'use strict';

/*
 * Content guard: the outbound-compliance baseline must keep its mandatory floor.
 *
 * Compliance is enforced in hooks, but the rule text is where a human (and the
 * outbound-reviewer) reads the floor. This guard pins that the baseline still
 * covers consent/lawful basis, accurate sender identity, a functional opt-out,
 * the AU/US/EU regimes, and that it is hook-protected from agent edits.
 */

const fs = require('fs');
const path = require('path');

const COMPLIANCE = path.join(__dirname, '..', '..', 'rules', 'common', 'outbound-compliance.md');
const content = fs.existsSync(COMPLIANCE) ? fs.readFileSync(COMPLIANCE, 'utf8') : '';

test('content-guard: rules/common/outbound-compliance.md exists and is non-empty', () => {
  assert.ok(content.trim().length > 0, 'rules/common/outbound-compliance.md must exist and be non-empty');
});

test('content-guard: compliance covers consent and lawful basis', () => {
  assert.ok(/consent/i.test(content), 'compliance must cover consent');
  assert.ok(/lawful basis/i.test(content), 'compliance must cover lawful basis');
});

test('content-guard: compliance requires accurate sender identity', () => {
  assert.ok(/sender identity/i.test(content), 'compliance must require accurate sender identity');
});

test('content-guard: compliance requires a functional unsubscribe / opt-out', () => {
  assert.ok(/unsubscribe|opt-out/i.test(content), 'compliance must require a functional unsubscribe / opt-out');
});

test('content-guard: compliance names the AU / US / EU regimes', () => {
  assert.ok(/Spam Act/i.test(content), 'compliance must reference the AU Spam Act 2003');
  assert.ok(/CAN-SPAM/i.test(content), 'compliance must reference US CAN-SPAM');
  assert.ok(/GDPR/i.test(content), 'compliance must reference EU/UK GDPR');
});

test('content-guard: compliance baseline is hook-protected from agent edits', () => {
  assert.ok(
    /compliance-protection/.test(content),
    'compliance baseline must note it is hook-protected (pre:compliance-protection)'
  );
});
