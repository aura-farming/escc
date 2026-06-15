'use strict';

const hook = require('../../scripts/hooks/attachment-quarantine');

function readInput(filePath) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: filePath },
  });
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

test('isQuarantinedPath flags attachment dirs and raw mail extensions', () => {
  assert.ok(hook.isQuarantinedPath('/work/attachments/proposal.pdf'));
  assert.ok(hook.isQuarantinedPath('inbound/lead-reply.eml'));
  assert.ok(hook.isQuarantinedPath('/x/quarantine/thing.docx'));
  assert.ok(hook.isQuarantinedPath('message.msg'));
  assert.ok(!hook.isQuarantinedPath('docs/notes.md'));
  assert.ok(!hook.isQuarantinedPath(''));
});

test('run BLOCKS a privileged read of a quarantined path', () => {
  withEnv({ ESCC_QUARANTINE_CONTEXT: undefined }, () => {
    const result = hook.run(readInput('/work/inbound/lead.eml'));
    assert.ok(result && result.exitCode === 2);
    assert.match(result.stderr, /quarantine subagent/i);
  });
});

test('run ALLOWS the read inside the quarantine subagent context', () => {
  withEnv({ ESCC_QUARANTINE_CONTEXT: '1' }, () => {
    const result = hook.run(readInput('/work/inbound/lead.eml'));
    assert.equal(result, undefined);
  });
});

test('run passes through an ordinary file read', () => {
  withEnv({ ESCC_QUARANTINE_CONTEXT: undefined }, () => {
    assert.equal(hook.run(readInput('scripts/lib/utils.js')), undefined);
  });
});

test('run fails OPEN on a truncated payload', () => {
  withEnv({ ESCC_QUARANTINE_CONTEXT: undefined }, () => {
    assert.equal(hook.run(readInput('/work/attachments/x.pdf'), { truncated: true }), undefined);
  });
});
