'use strict';

/*
 * Content-guard: opt-out hook-enforcement wiring (v1.10.0).
 *
 * An inbound opt-out is only machine-enforced once it lands in the LOCAL
 * do_not_contact store the fail-closed send-gate reads — a CRM-side suppression
 * flag gates nothing at the tool boundary. This guard pins that wiring: the
 * opt-out-handling skill must direct the operator to `escc dnc record` and say
 * why (the send-gate reads that store), so a future rewrite of the skill cannot
 * silently regress the opt-out path back to CRM-only suppression.
 */

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, '..', '..', 'skills', 'opt-out-handling', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8');

test('opt-out-handling writes the local send-gate blocklist (escc dnc record)', () => {
  assert.match(skill, /escc dnc record/, 'the skill must run the blessed local-blocklist write');
});

test('opt-out-handling says WHY the local row matters (the send-gate reads it)', () => {
  assert.match(skill, /send-gate/i);
});

test('opt-out-handling names CRM-only suppression as an anti-pattern', () => {
  assert.match(skill, /CRM-only suppression/i);
});

test('the CLI verb the skill depends on exists and is advertised', () => {
  const dnc = require('../../scripts/lib/do-not-contact');
  assert.equal(typeof dnc.runDnc, 'function');
  assert.match(require('../../scripts/escc').HELP, /dnc record --key/);
});
