'use strict';

const hook = require('../../scripts/hooks/compliance-protection');

function editInput(filePath, content) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: content || '' },
  });
}

test('isProtected flags compliance rule files and jurisdiction overlays', () => {
  assert.ok(hook.isProtected('rules/common/outbound-compliance.md'));
  assert.ok(hook.isProtected('/abs/rules/common/data-handling.md'));
  assert.ok(hook.isProtected('rules/jurisdictions/au.md'));
  assert.ok(hook.isProtected('rules/common/lawful-basis.md'));
  assert.ok(hook.isProtected('the-compliance-guide.md'));
});

test('isProtected does NOT flag unrelated files or same-name files outside rules/', () => {
  assert.ok(!hook.isProtected('src/components/Hero.tsx'));
  assert.ok(!hook.isProtected('notes/data-handling.md'), 'data-handling.md outside rules/ is not protected');
  assert.ok(!hook.isProtected(''));
});

test('run BLOCKS an edit to a protected compliance file', () => {
  const result = hook.run(editInput('rules/common/outbound-compliance.md', '# weakened'));
  assert.ok(result && result.exitCode === 2);
  assert.match(result.stderr, /compliance-bearing file/i);
});

test('run passes through an edit to an ordinary file', () => {
  const result = hook.run(editInput('skills/cold-calling/SKILL.md', '# content'));
  assert.equal(result, undefined);
});

test('run BLOCKS on a truncated payload (cannot verify target)', () => {
  const result = hook.run(editInput('whatever.md'), { truncated: true });
  assert.ok(result && result.exitCode === 2);
});

test('run warns (additionalContext) on a sequence file with no unsubscribe block', () => {
  const result = hook.run(editInput('deliverables/outbound/sequences/step-1.md', 'Hi {{firstName}}, quick note.'));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /unsubscribe/i);
});

test('run passes through a sequence file that includes an unsubscribe block', () => {
  const result = hook.run(editInput('deliverables/outbound/sequences/step-1.md', 'Hi. Reply STOP to unsubscribe.'));
  assert.equal(result, undefined);
});
