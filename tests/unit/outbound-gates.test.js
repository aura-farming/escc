'use strict';

/**
 * Tests for the deterministic four-gate engine (scripts/lib/outbound-gates.js).
 * Each gate gets a passing AND a failing fixture, drawn from the real session
 * that motivated the outbound-enforcement work:
 *   - a contact who said "call back in six weeks" must not get an email now;
 *   - a draft claiming "you asked me to send a comparison" when the note says
 *     "he'll have a look through the website" must block (fabrication firewall);
 *   - an opener that leads with "a Tanda vs Deputy comparison" must block (WIIFM);
 *   - demo-booked / handed-to-AE / declined accounts must block (contactability).
 * Pure module — no env, no state store.
 */

const gates = require('../../scripts/lib/outbound-gates');

// --- helpers: window parsing ---

test('parseWindowDays parses worded and numeric relative windows', () => {
  assert.equal(gates.parseWindowDays('six weeks'), 42);
  assert.equal(gates.parseWindowDays('a month'), 30);
  assert.equal(gates.parseWindowDays('next quarter'), 90);
  assert.equal(gates.parseWindowDays('2 days'), 2);
  assert.equal(gates.parseWindowDays('couple of weeks'), 14);
  assert.equal(gates.parseWindowDays('whenever you like'), 0);
});

// --- Gate 1: timing / do-not-contact-until ---

test('gateTiming BLOCKS an email inside a "call back in six weeks" window', () => {
  const records = { notes: [{ date: '2026-06-01', text: 'Spoke briefly — call back in six weeks, slammed until then.' }] };
  const v = gates.gateTiming({ records, now: '2026-06-23' });
  assert.equal(v.status, 'block');
  assert.ok(v.not_before, 'a not-before date is set');
  assert.ok(new Date(v.not_before) > new Date('2026-07-01'), 'not-before is ~6 weeks out');
  assert.ok(v.blocklist && v.blocklist.scope === 'contact');
});

test('gateTiming PASSES once the requested window has elapsed', () => {
  const records = { notes: [{ date: '2026-06-01', text: 'call back in six weeks' }] };
  const v = gates.gateTiming({ records, now: '2026-08-01' });
  assert.equal(v.status, 'pass');
});

test('gateTiming BLOCKS indefinitely on an explicit do-not-contact note', () => {
  const records = { notes: [{ date: '2026-05-01', text: 'Please do not contact me again.' }] };
  const v = gates.gateTiming({ records, now: '2027-01-01' });
  assert.equal(v.status, 'block');
  assert.equal(v.not_before, null, 'indefinite suppression has no not-before');
});

// --- Gate 2: claim-vs-record (fabrication firewall) ---

test('gateClaims BLOCKS an unsupported "you asked me to send a comparison" claim', () => {
  const draft = { body: 'Hi Sam, you asked me to send a comparison, so here it is.' };
  const records = {
    notes: [
      { date: '2026-06-10', text: "Called the owner; he'll have a look through the website." },
      { date: '2026-06-12', text: 'Still reviewing on their side; no request for materials.' },
    ],
  };
  const v = gates.gateClaims({ draft, records });
  assert.equal(v.status, 'block');
  assert.match(v.reason, /not supported by any call\/note/i);
});

test('gateClaims PASSES when a note backs the claim', () => {
  const draft = { body: 'As you requested, here is the comparison of the two rostering tools.' };
  const records = { notes: [{ date: '2026-06-12', text: 'On the call he asked for a comparison of the two tools.' }] };
  const v = gates.gateClaims({ draft, records });
  assert.equal(v.status, 'pass');
});

test('gateClaims PASSES when the claim is explicitly attested via verifiedClaims', () => {
  const draft = { body: 'You agreed to a pilot next month.' };
  const records = { notes: [], verifiedClaims: ['You agreed to a pilot next month.'] };
  const v = gates.gateClaims({ draft, records });
  assert.equal(v.status, 'pass');
});

test('gateClaims ignores a draft that makes no prior-interaction claim', () => {
  const draft = { body: 'Hi Sam — rostering across 4 sites usually means hidden overtime; worth a look?' };
  const v = gates.gateClaims({ draft, records: { notes: [] } });
  assert.equal(v.status, 'pass');
});

// --- Gate 3: WIIFM ---

test('gateWiifm BLOCKS a product-first opener for a cold prospect', () => {
  const draft = { body: "Here's a Tanda vs Deputy comparison I put together for you." };
  const v = gates.gateWiifm({ draft, records: { priorEngagement: false } });
  assert.equal(v.status, 'block');
  assert.match(v.reason, /payoff|product\/process/i);
});

test('gateWiifm only WARNS on a product-first opener when there is prior engagement', () => {
  const draft = { body: 'Let me show you the dashboard we discussed.' };
  const v = gates.gateWiifm({ draft, records: { priorEngagement: true } });
  assert.equal(v.status, 'warn');
});

test('gateWiifm PASSES a benefit-led opener', () => {
  const draft = { body: 'You could cut the overtime your 4 venues rack up each fortnight — here is how.' };
  const v = gates.gateWiifm({ draft, records: { priorEngagement: false } });
  assert.equal(v.status, 'pass');
});

// --- Gate 4: contactability ---

test('gateContactability BLOCKS an account with an open deal', () => {
  const v = gates.gateContactability({ records: { open_deals: [{ id: '1' }] } });
  assert.equal(v.status, 'block');
  assert.ok(v.blocklist && v.blocklist.scope === 'account');
});

test('gateContactability BLOCKS demo-booked / handed-to-AE / declined accounts', () => {
  assert.equal(gates.gateContactability({ records: { demo_booked: true } }).status, 'block');
  assert.equal(gates.gateContactability({ records: { handed_to_ae: true } }).status, 'block');
  assert.equal(gates.gateContactability({ records: { lead_status: 'Declined - happy with current' } }).status, 'block');
  assert.equal(gates.gateContactability({ records: { lifecycle: 'customer' } }).status, 'block');
});

test('gateContactability PASSES a clean, contactable prospect', () => {
  const v = gates.gateContactability({ records: { lead_status: 'new', open_deals: [] } });
  assert.equal(v.status, 'pass');
});

// --- evaluateGates aggregate ---

test('evaluateGates PASSES a clean draft and reports no blocks', () => {
  const draft = { body: 'You could cut overtime across your venues — open to a quick look next week?' };
  const records = { notes: [], lead_status: 'new', open_deals: [], priorEngagement: false };
  const r = gates.evaluateGates({ draft, records, now: '2026-06-23' });
  assert.equal(r.pass, true);
  assert.equal(r.blocks.length, 0);
});

test('evaluateGates fails and collects blocks + blocklist writes when a gate blocks', () => {
  const draft = { body: "Here's a Tanda vs Deputy comparison." };
  const records = { notes: [], open_deals: [{ id: 'd1' }], priorEngagement: false };
  const r = gates.evaluateGates({ draft, records, now: '2026-06-23' });
  assert.equal(r.pass, false);
  // both WIIFM and contactability should block this one
  const gateNames = r.blocks.map(b => b.gate).sort();
  assert.ok(gateNames.includes('contactability'));
  assert.ok(gateNames.includes('wiifm'));
  assert.ok(r.blocklistWrites.length >= 1, 'contactability writes the account to the blocklist');
});

// --- inspectPayload: the cheap, no-records hook subset ---

test('inspectPayload hard-fails an egregious overclaim', () => {
  const r = gates.inspectPayload({ recipient: 'a@b.com', subject: 'Hi', body: 'We deliver guaranteed ROI in 30 days.' });
  assert.ok(r.block, 'egregious overclaim is hard-failed');
});

test('inspectPayload warns (does not block) on an unverifiable prior-interaction claim', () => {
  const r = gates.inspectPayload({ body: 'As we discussed, here is the proposal.' });
  assert.equal(r.block, null);
  assert.ok(r.warnings.some(w => /prior interaction/i.test(w)));
});

test('inspectPayload is silent on a clean, benefit-led payload', () => {
  const r = gates.inspectPayload({ body: 'You could save your team hours each week on rostering — worth a look?' });
  assert.equal(r.block, null);
  assert.equal(r.warnings.length, 0);
});
