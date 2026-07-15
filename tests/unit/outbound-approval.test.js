'use strict';

/**
 * Tests for the v1.1.0 tool-agnostic approval token + richer outbound
 * classification (scripts/lib/outbound-review.js). The crux: ONE approval keyed
 * by recipient + content hash matches the Gmail draft AND a later HubSpot
 * outbound-email of the same content; and HubSpot tasks/notes/deals are NOT
 * treated as outbound. Hermetic: each case uses a fresh ESCC_AGENT_DATA_HOME.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const review = require('../../scripts/lib/outbound-review');

const DRAFT_TOOL = 'mcp__claude_ai_Gmail__create_draft';
const HUBSPOT = 'mcp__hubspot__manage_crm_objects';
const SEND_TOOL = 'mcp__test__send_email';

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-approval-'));
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

// --- content key ---

test('outboundContentKey is stable and ignores recipient/field aliases + case', () => {
  const a = review.outboundContentKey({ to: 'Sam@company.example', subject: 'Reporting', body: 'Hi Sam' });
  const b = review.outboundContentKey({ recipient: 'sam@company.example', subject: 'Reporting', body: 'Hi Sam' });
  assert.equal(a, b, 'recipient alias + case must not change the key');
  const c = review.outboundContentKey({ to: 'sam@company.example', subject: 'Reporting', body: 'Hi Sam!!' });
  assert.notEqual(a, c, 'different body changes the key');
});

test('the SAME content via a Gmail draft and a HubSpot email yields the SAME key (tool-agnostic)', () => {
  const draftPayload = review.extractOutboundPayload(DRAFT_TOOL, { to: 'sam@company.example', subject: 'Reporting', body: 'Hi Sam' });
  const crmPayload = review.extractOutboundPayload(HUBSPOT, {
    objectType: 'emails',
    properties: { hs_email_to_email: 'sam@company.example', hs_email_subject: 'Reporting', hs_email_html: 'Hi Sam' },
  });
  assert.equal(review.outboundContentKey(draftPayload), review.outboundContentKey(crmPayload),
    'one approval must cover the draft and the later send of the same content');
});

// --- approval record + lookup ---

test('recordApproval then findValidApproval round-trips for the same key', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const key = review.outboundContentKey({ to: 'a@b.example', subject: 'S', body: 'B' });
    review.recordApproval({ sessionId: 's1', key, recipient: 'a@b.example', confidence: 0.95 });
    assert.ok(review.findValidApproval({ key }), 'a recorded approval is found');
  });
});

test('findValidApproval rejects below-confidence and expired approvals', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const key = review.outboundContentKey({ to: 'a@b.example', subject: 'S', body: 'B' });
    review.recordApproval({ key, confidence: 0.4 });
    assert.equal(review.findValidApproval({ key, minConfidence: 0.8 }), null, 'low-confidence approval is not valid');
  });
  withEnv({ ESCC_AGENT_DATA_HOME: freshHome() }, () => {
    const key = review.outboundContentKey({ to: 'a@b.example', subject: 'S', body: 'B2' });
    // approved a while ago with a 60-minute TTL → expired by now
    review.recordApproval({ key, confidence: 0.99, now: '2026-01-01T00:00:00Z', ttlMinutes: 60 });
    assert.equal(review.findValidApproval({ key, now: '2026-01-01T02:00:00Z' }), null, 'expired approval is not valid');
    assert.ok(review.findValidApproval({ key, now: '2026-01-01T00:30:00Z' }), 'still-valid approval is found');
  });
});

// --- classification: the over-block firewall ---

test('classifyOutbound gates a Gmail draft and extracts its payload', () => {
  const c = review.classifyOutbound(DRAFT_TOOL, { to: 'a@b.example', subject: 'S', body: 'B' });
  assert.equal(c.kind, 'draft');
  assert.equal(c.recipient, 'a@b.example');
});

test('classifyOutbound gates a HubSpot OUTBOUND email engagement', () => {
  const c = review.classifyOutbound(HUBSPOT, {
    objectType: 'emails',
    properties: { hs_email_direction: 'EMAIL', hs_email_to_email: 'a@b.example', hs_email_subject: 'S', hs_email_html: 'B' },
  });
  assert.equal(c.kind, 'crm-email');
  assert.equal(c.recipient, 'a@b.example');
});

test('classifyOutbound does NOT gate HubSpot tasks / notes / deals (the hard constraint)', () => {
  assert.equal(review.classifyOutbound(HUBSPOT, { objectType: 'tasks', properties: { hs_task_subject: 'Call Sam back' } }).kind, 'allow');
  assert.equal(review.classifyOutbound(HUBSPOT, { objectType: 'notes', properties: { hs_note_body: 'Spoke to Sam' } }).kind, 'allow');
  assert.equal(review.classifyOutbound(HUBSPOT, { objectType: 'deals', properties: { dealstage: 'qualified' } }).kind, 'allow');
});

test('classifyOutbound does NOT gate an INCOMING (logged) email engagement', () => {
  const c = review.classifyOutbound(HUBSPOT, {
    objectType: 'emails',
    properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'Re: hello' },
  });
  assert.equal(c.kind, 'allow');
});

test('classifyOutbound still recognizes legacy sends, reads, and unrelated tools', () => {
  assert.equal(review.classifyOutbound(SEND_TOOL, { to: 'a@b.example' }).kind, 'send');
  assert.equal(review.classifyOutbound('mcp__hubspot__search_crm_objects', {}).kind, 'allow');
  assert.equal(review.classifyOutbound('Read', {}).kind, 'other');
});
