'use strict';

const hook = require('../../scripts/hooks/crm-log-reminder');

function toolInput(name, input) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: name,
    tool_input: input || {},
  });
}

test('nudges to log a HubSpot email activity after a Gmail draft', () => {
  const result = hook.run(toolInput('mcp__claude_ai_Gmail__create_draft', { to: 'cfo@acme.example', subject: 'Pricing' }));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /HubSpot email activity/i);
  assert.match(result.additionalContext, /cfo@acme\.example/);
});

test('nudges to log a HubSpot meeting after a Calendar event', () => {
  const result = hook.run(toolInput('mcp__claude_ai_Google_Calendar__create_event', { summary: 'Example Co demo' }));
  assert.ok(result && result.additionalContext);
  assert.match(result.additionalContext, /HubSpot meeting/i);
  assert.match(result.additionalContext, /Example Co demo/);
});

test('nudges to log a call after a Fireflies transcript fetch', () => {
  const result = hook.run(toolInput('mcp__claude_ai_Fireflies__get_transcript', {}));
  assert.ok(result && result.additionalContext);
  assert.match(result.additionalContext, /call/i);
  assert.match(result.additionalContext, /HubSpot activity/i);
});

test('returns undefined for an unrelated tool', () => {
  assert.equal(hook.run(toolInput('Read', { file_path: '/tmp/x.md' })), undefined);
  assert.equal(hook.run(toolInput('mcp__hubspot__manage_crm_objects', { operation: 'update' })), undefined);
});

test('still emits a (generic) nudge on a truncated payload', () => {
  const result = hook.run(toolInput('mcp__claude_ai_Gmail__create_draft', { to: 'x@y.example' }), { truncated: true });
  assert.ok(result && result.additionalContext);
  assert.match(result.additionalContext, /email/i);
  // recipient detail is intentionally NOT mined from a truncated body
  assert.ok(!/x@y\.example/.test(result.additionalContext));
});

test('handles a comma-separated recipient list (takes the first address)', () => {
  const result = hook.run(toolInput('mcp__claude_ai_Gmail__create_draft', { to: 'a@b.example, c@d.example' }));
  assert.match(result.additionalContext, /a@b\.example/);
  assert.ok(!/c@d\.example/.test(result.additionalContext));
});

test('matchReminder maps each tool name to the right rule', () => {
  assert.equal(hook.matchReminder('mcp__claude_ai_Gmail__create_draft').kind, 'gmail_draft');
  assert.equal(hook.matchReminder('mcp__claude_ai_Google_Calendar__create_event').kind, 'calendar_event');
  assert.equal(hook.matchReminder('mcp__claude_ai_Fireflies__authenticate').kind, 'fireflies_transcript');
  assert.equal(hook.matchReminder('SomethingElse'), null);
  assert.equal(hook.matchReminder(''), null);
});

test('fails open (no throw) on malformed raw input', () => {
  assert.equal(hook.run('not json at all'), undefined);
});
