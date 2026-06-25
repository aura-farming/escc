'use strict';

/*
 * Operator-gated ingest/promotion (addApproved / approveCandidate / requiredFieldErrors)
 * and the quarantine miner (product-mine). The THREAT here is that field-mined material
 * could reach quotable status without a human; these tests pin that it cannot.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const pk = require('../../scripts/lib/product-knowledge');
const mine = require('../../scripts/lib/product-mine');

function withHome(seed, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-ops-'));
  const prev = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = home;
  try {
    if (seed) {
      const dir = path.join(home, 'escc', 'product');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'product-knowledge.json'), JSON.stringify(seed));
    }
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prev;
  }
}

test('requiredFieldErrors mirrors the schema per type and rejects approved+untrusted', () => {
  assert.deepEqual(pk.requiredFieldErrors({ id: 'a', type: 'claim', text: 'x', source_type: 'public' }), []);
  assert.ok(pk.requiredFieldErrors({ type: 'claim', text: 'x', source_type: 'public' }).length, 'missing id');
  assert.ok(pk.requiredFieldErrors({ id: 'a', type: 'objection', pattern: 'p', source_type: 'manual' }).some(e => /response/.test(e)), 'objection needs response');
  assert.ok(pk.requiredFieldErrors({ id: 'a', type: 'battlecard', competitor: 'competitor-x', differentiation: 'd', source_type: 'public' }).some(e => /guardrail/.test(e)), 'battlecard needs guardrail');
  assert.ok(pk.requiredFieldErrors({ id: 'a', type: 'claim', text: 'x', source_type: 'call', approved: true, untrusted: true }).some(e => /firewall/.test(e)));
});

test('addApproved requires approved_by, validates vocab, and preserves existing rows', () => {
  const seed = [{ id: 'PK-1', type: 'claim', text: 'existing', segment: 'general', source_type: 'public', approved: true, approved_by: 'Example Operator', last_verified: '2026-06-24' }];
  withHome(seed, () => {
    assert.equal(pk.addApproved({ id: 'X', type: 'claim', text: 'x', source_type: 'public' }, {}).ok, false, 'no approved_by -> rejected');
    assert.equal(pk.addApproved({ id: 'X', type: 'value-prop', text: 'x', role: 'wizard', source_type: 'public' }, { approvedBy: 'Example Operator' }).ok, false, 'free-text role -> rejected');
    const res = pk.addApproved({ id: 'PK-2', type: 'value-prop', text: 'new', segment: 'general', role: 'finance', source_type: 'public' }, { approvedBy: 'Example Operator', now: '2026-06-25T00:00:00Z' });
    assert.ok(res.ok, JSON.stringify(res.errors));
    assert.equal(res.entry.approved, true);
    assert.equal(res.entry.untrusted, false);
    assert.equal(res.entry.approved_by, 'Example Operator');
    const all = pk.readApprovedFile();
    assert.deepEqual(all.map(r => r.id).sort(), ['PK-1', 'PK-2'], 'existing row preserved');
  });
});

test('approveCandidate is the human gate: promotes a candidate and removes it from the candidate area', () => {
  withHome(null, () => {
    pk.appendCandidate({ id: 'C-1', type: 'pain', role: 'finance', text: 'mined pain', source_type: 'call' });
    assert.equal(pk.approveCandidate('C-1', {}).ok, false, 'no approved_by -> rejected');
    assert.equal(pk.approveCandidate('nope', { approvedBy: 'Example Operator' }).ok, false, 'unknown id -> rejected');
    const res = pk.approveCandidate('C-1', { approvedBy: 'Example Operator', now: '2026-06-25T00:00:00Z' });
    assert.ok(res.ok, JSON.stringify(res.errors));
    assert.equal(res.entry.approved, true);
    assert.equal(res.entry.untrusted, false);
    assert.deepEqual(pk.readApproved().map(r => r.id), ['C-1'], 'now in the approved store');
    assert.equal(pk.readCandidates().length, 0, 'removed from the candidate area');
  });
});

test('miner: extractObjectionCandidates flags only cue-matched lines, never infers a response', () => {
  const text = 'We already have a tool for this. The weather is nice today. Honestly it is too expensive for us.';
  const cands = mine.extractObjectionCandidates(text, { sourceRef: 'call:1' });
  assert.equal(cands.length, 2, 'two cue lines flagged, the neutral one ignored');
  for (const c of cands) {
    assert.equal(c.type, 'objection');
    assert.ok(/candidate/i.test(c.response), 'no inferred response — placeholder only');
    assert.equal(c.source_type, 'call');
  }
});

test('miner: ingestCandidates forces approved:false + untrusted:true (cannot ever approve)', () => {
  withHome(null, () => {
    const stored = mine.ingestCandidates(
      [{ type: 'objection', pattern: 'we already have a tool', response: 'r', approved: true, untrusted: false }],
      { sourceType: 'email', sourceRef: 'email:1' });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].approved, false, 'forced not-approved even though caller passed approved:true');
    assert.equal(stored[0].untrusted, true);
    const back = pk.readCandidates();
    assert.equal(back.length, 1);
    assert.equal(back[0].source_type, 'email');
  });
});
