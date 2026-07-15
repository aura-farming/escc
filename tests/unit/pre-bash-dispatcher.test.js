'use strict';

const hook = require('../../scripts/hooks/pre-bash-dispatcher');

function bashInput(command) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
}

test('inspectRm: allows recursive force delete under temp dirs', () => {
  assert.equal(hook.inspectRm('rm -rf /tmp/build').block, false);
  assert.equal(hook.inspectRm('rm -rf /private/tmp/x').block, false);
  assert.equal(hook.inspectRm('rm -rf $TMPDIR/cache').block, false);
});

test('inspectRm: blocks recursive force delete outside temp dirs and on bare dangerous targets', () => {
  assert.equal(hook.inspectRm('rm -rf /Users/me/project').block, true);
  assert.equal(hook.inspectRm('rm -rf /').block, true);
  assert.equal(hook.inspectRm('rm -rf ~').block, true);
  assert.equal(hook.inspectRm('rm -fr ./src').block, true);
});

test('inspectRm: ignores non-recursive or non-force rm', () => {
  assert.equal(hook.inspectRm('rm file.txt').block, false);
  assert.equal(hook.inspectRm('rm -r somedir').block, false); // no force
  assert.equal(hook.inspectRm('ls -la').block, false);
});

test('run BLOCKS rm -rf on a non-temp path', () => {
  const result = hook.run(bashInput('rm -rf /Users/me/important'));
  assert.ok(result && result.exitCode === 2);
  assert.match(result.stderr, /rm -rf/i);
});

test('run passes through rm -rf under /tmp', () => {
  assert.equal(hook.run(bashInput('rm -rf /tmp/escc-build')), undefined);
});

test('run BLOCKS an obvious CLI bulk-mail pattern', () => {
  const result = hook.run(bashInput('for a in $(cat leads.txt); do mail -s "hi" $a < body.txt; done'));
  assert.ok(result && result.exitCode === 2);
  assert.match(result.stderr, /bulk-mail/i);
});

test('run warns on a single CLI mail send (bypasses the gate)', () => {
  const result = hook.run(bashInput('echo body | mail -s "hello" prospect@company.example'));
  assert.ok(result && result.additionalContext);
  assert.match(result.additionalContext, /outbound-send-gate/i);
});

test('run passes through an ordinary command', () => {
  assert.equal(hook.run(bashInput('git status && npm test')), undefined);
});

test('run fails open on a truncated payload', () => {
  assert.equal(hook.run(bashInput('rm -rf /Users/me/important'), { truncated: true }), undefined);
});
