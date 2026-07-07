'use strict';

const hook = require('../../scripts/hooks/deliverables-location');

function writeInput(filePath, content) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: content || '' },
  });
}

// ---- classification --------------------------------------------------------

test('isStrayDoc flags doc-like files outside deliverables/ and structural dirs', () => {
  assert.ok(hook.isStrayDoc('account-research.md'));
  assert.ok(hook.isStrayDoc('output/pipeline-report.csv'));
  assert.ok(hook.isStrayDoc('/abs/Downloads/proposal.docx'));
  assert.ok(hook.isStrayDoc('summary.pdf'));
  assert.ok(hook.isStrayDoc('export.html'));
});

test('isStrayDoc ignores files already under deliverables/', () => {
  assert.ok(!hook.isStrayDoc('deliverables/research/acme.md'));
  assert.ok(!hook.isStrayDoc('deliverables/outbound/sequences/step-1.md'));
  assert.ok(!hook.isStrayDoc('/abs/deliverables/reports/q3.csv'));
});

test('isStrayDoc ignores structural repo directories', () => {
  assert.ok(!hook.isStrayDoc('skills/cold-calling/SKILL.md'));
  assert.ok(!hook.isStrayDoc('agents/crm-operator.md'));
  assert.ok(!hook.isStrayDoc('commands/plan.md'));
  assert.ok(!hook.isStrayDoc('rules/common/data-handling.md'));
  assert.ok(!hook.isStrayDoc('docs/getting-started.md'));
  assert.ok(!hook.isStrayDoc('scripts/hooks/notes.md'));
  assert.ok(!hook.isStrayDoc('tests/fixtures/sample.txt'));
  assert.ok(!hook.isStrayDoc('schemas/notes.md'));
  assert.ok(!hook.isStrayDoc('.github/PULL_REQUEST_TEMPLATE.md'));
});

test('isStrayDoc ignores structural repo files by basename anywhere', () => {
  assert.ok(!hook.isStrayDoc('README.md'));
  assert.ok(!hook.isStrayDoc('CHANGELOG.md'));
  assert.ok(!hook.isStrayDoc('LICENSE'));
  assert.ok(!hook.isStrayDoc('CLAUDE.md'));
  assert.ok(!hook.isStrayDoc('AGENTS.md'));
  assert.ok(!hook.isStrayDoc('SOUL.md'));
  assert.ok(!hook.isStrayDoc('some/nested/dir/README.md'));
});

test('isStrayDoc ignores non-doc extensions', () => {
  assert.ok(!hook.isStrayDoc('script.js'));
  assert.ok(!hook.isStrayDoc('config.json'));
  assert.ok(!hook.isStrayDoc('image.png'));
  assert.ok(!hook.isStrayDoc(''));
});

// ---- run behavior ----------------------------------------------------------

test('run nudges a stray generated doc toward deliverables/', () => {
  const result = hook.run(writeInput('account-research.md', '# Example Co research'));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /deliverables\//);
  assert.match(result.additionalContext, /account-research\.md/);
});

test('run passes through a file already under deliverables/', () => {
  const result = hook.run(writeInput('deliverables/research/acme.md', '# Example Co research'));
  assert.equal(result, undefined);
});

test('run passes through a structural repo file', () => {
  const result = hook.run(writeInput('skills/cold-calling/SKILL.md', '# skill'));
  assert.equal(result, undefined);
});

test('run never returns a blocking exit code', () => {
  const result = hook.run(writeInput('proposal.docx', 'x'));
  assert.ok(result && result.exitCode === undefined, 'warn-only, never blocks');
});

test('run fails open (no throw) on malformed input', () => {
  assert.doesNotThrow(() => hook.run('not json'));
  assert.doesNotThrow(() => hook.run(undefined));
  assert.doesNotThrow(() => hook.run('{ "tool_input": null }'));
});
