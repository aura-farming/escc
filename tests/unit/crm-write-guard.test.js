'use strict';

const hook = require('../../scripts/hooks/crm-write-guard');

function crmInput(toolInput) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__hubspot__manage_crm_objects',
    tool_input: toolInput,
  });
}

test('warns on a CRM delete/archive', () => {
  const result = hook.run(crmInput({ operation: 'delete', objectType: 'deals', objectId: '123' }), { profile: 'standard' });
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /delete/i);
});

test('warns (standard) on a stage advance with no next step', () => {
  const result = hook.run(crmInput({ operation: 'update', objectType: 'deals', properties: { dealstage: 'decisionmaker' } }), { profile: 'standard' });
  assert.ok(result && result.additionalContext);
  assert.match(result.additionalContext, /next step/i);
});

test('BLOCKS (strict) a stage advance with no next step', () => {
  const result = hook.run(crmInput({ operation: 'update', objectType: 'deals', properties: { dealstage: 'decisionmaker' } }), { profile: 'strict' });
  assert.ok(result && result.exitCode === 2);
  assert.match(result.stderr, /next step/i);
});

test('passes through a stage advance that includes a next step', () => {
  const result = hook.run(crmInput({ operation: 'update', objectType: 'deals', properties: { dealstage: 'decisionmaker', hs_next_step: 'Send MSA' } }), { profile: 'strict' });
  assert.equal(result, undefined);
});

test('passes through an ordinary property update', () => {
  const result = hook.run(crmInput({ operation: 'update', objectType: 'contacts', properties: { jobtitle: 'VP Sales' } }), { profile: 'strict' });
  assert.equal(result, undefined);
});

test('guards a property/schema mutation (block in strict)', () => {
  const result = hook.run(crmInput({ operation: 'create_property', objectType: 'deal_property', properties: { name: 'custom' } }), { profile: 'strict' });
  assert.ok(result && result.exitCode === 2);
});

test('fails open on truncated payload', () => {
  assert.equal(hook.run(crmInput({ operation: 'delete' }), { truncated: true, profile: 'strict' }), undefined);
});
