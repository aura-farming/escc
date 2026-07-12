'use strict';

/*
 * Tests for the post:chaining-hints hook (ADR-0016) — the next-play suggestion
 * layer. Exercises the REAL config/tool-skill-chains.json. Dedupe is
 * per-session, so each case uses a fresh random session id.
 */

const crypto = require('crypto');

const hook = require('../../scripts/hooks/chaining-hints');

function freshSession() {
  return `test-${crypto.randomBytes(6).toString('hex')}`;
}

function toolResult(name, input, sessionId, extra) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: name,
    tool_input: input || {},
    session_id: sessionId || freshSession(),
    ...(extra || {}),
  });
}

test('a Fireflies transcript fetch chains to discovery-notes', () => {
  const result = hook.run(toolResult('mcp__claude_ai_Fireflies__get_transcript', { id: 't-1' }));
  assert.ok(result && result.additionalContext);
  assert.match(result.additionalContext, /discovery-notes/);
  assert.match(result.additionalContext, /escc next-step/);
});

test('a Gmail thread read chains to reply-handling', () => {
  const result = hook.run(toolResult('mcp__claude_ai_Gmail__get_thread', { thread_id: 'x' }));
  assert.ok(result && result.additionalContext);
  assert.match(result.additionalContext, /reply-handling/);
});

test('a HubSpot DEAL read chains to deal-review; a contact read does not', () => {
  const dealRead = hook.run(toolResult('mcp__hubspot__search_crm_objects', { objectType: 'deals', query: 'open' }));
  assert.ok(dealRead && /deal-review/.test(dealRead.additionalContext), 'deal read hints deal-review');

  const contactRead = hook.run(toolResult('mcp__hubspot__search_crm_objects', { objectType: 'contacts', query: 'smith' }));
  assert.equal(contactRead, undefined, 'a non-deal CRM read gets no hint (input_match filter)');
});

test('a Gmail draft creation chains to the worklist batch on-ramp (ADR-0020)', () => {
  const result = hook.run(toolResult('mcp__claude_ai_Gmail__create_draft', { to: 'a@b.example', subject: 'S', body: 'B' }));
  assert.ok(result && result.additionalContext, 'a create_draft result yields a hint');
  assert.match(result.additionalContext, /worklist/);
  assert.match(result.additionalContext, /escc next-step/);
});

test('each chain family fires at most ONCE per session', () => {
  const session = freshSession();
  const first = hook.run(toolResult('mcp__claude_ai_Fireflies__get_transcript', {}, session));
  assert.ok(first && first.additionalContext, 'first transcript fetch hints');
  const second = hook.run(toolResult('mcp__claude_ai_Fireflies__get_transcript', {}, session));
  assert.equal(second, undefined, 'second fetch in the same session is deduped');

  // A DIFFERENT family still fires in the same session.
  const other = hook.run(toolResult('mcp__claude_ai_Gmail__get_thread', {}, session));
  assert.ok(other && /reply-handling/.test(other.additionalContext), 'other family unaffected');
});

test('an errored tool call gets no next-play hint', () => {
  const viaFlag = hook.run(toolResult('mcp__claude_ai_Fireflies__get_transcript', {}, freshSession(), { is_error: true }));
  assert.equal(viaFlag, undefined);
  const viaResponse = hook.run(
    toolResult('mcp__claude_ai_Gmail__get_thread', {}, freshSession(), { tool_response: { is_error: true } })
  );
  assert.equal(viaResponse, undefined);
});

test('a truncated payload cannot satisfy an input_match filter (no false deal hint)', () => {
  const result = hook.run(
    toolResult('mcp__hubspot__search_crm_objects', { objectType: 'deals' }, freshSession()),
    { truncated: true }
  );
  assert.equal(result, undefined, 'input-filtered chain is skipped when the input is untrustworthy');
});

test('unrelated tools and malformed input fail open', () => {
  assert.equal(hook.run(toolResult('Read', { file_path: '/tmp/x' })), undefined);
  assert.equal(hook.run(toolResult('mcp__hubspot__manage_crm_objects', { objectType: 'deals' })), undefined, 'writes are not chained');
  assert.equal(hook.run('not json at all'), undefined);
  assert.equal(hook.run(''), undefined);
});

test('every configured chain names a real skill directory', () => {
  const fs = require('fs');
  const path = require('path');
  const chains = hook.loadChains();
  assert.ok(chains.length >= 3, `expected at least 3 chains (got ${chains.length})`);
  const skillsDir = path.join(__dirname, '..', '..', 'skills');
  for (const c of chains) {
    assert.ok(
      fs.existsSync(path.join(skillsDir, c.skill, 'SKILL.md')),
      `chain "${c.family}" must point at an existing skill (${c.skill})`
    );
  }
});

test('input_match is word-boundaried: a contact at "Dealify Inc" gets NO deal hint', () => {
  const result = hook.run(
    toolResult('mcp__hubspot__search_crm_objects', {
      objectType: 'contacts',
      properties: { company_name: 'Dealify Inc' },
      query: 'dealify',
    })
  );
  assert.equal(result, undefined, 'substring "deal" inside another word must not trigger the chain');
});

test('a query_crm_data query mentioning deals DOES chain to deal-review', () => {
  const result = hook.run(toolResult('mcp__hubspot__query_crm_data', { query: 'open deals closing this month' }));
  assert.ok(result && /deal-review/.test(result.additionalContext));
});
