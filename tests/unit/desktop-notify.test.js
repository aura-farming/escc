'use strict';

/*
 * Unit tests for scripts/hooks/desktop-notify.js (stop:desktop-notify).
 *
 * Hermetic: ESCC_AGENT_DATA_HOME points at a fresh os.tmpdir() directory so the
 * notification queue (written by the shared notify.js layer) lands under a
 * throwaway state dir, and ESCC_NOTIFY_NO_DESKTOP=1 disables real desktop
 * delivery so the suite never pops a macOS/Linux notification. We assert
 * delivery via the central JSONL queue rather than via osascript.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/desktop-notify.js');
const { drainNotifications } = require('../../scripts/lib/notify.js');

function withTempStateDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-desktop-notify-'));
  const saved = {
    home: Object.prototype.hasOwnProperty.call(process.env, 'ESCC_AGENT_DATA_HOME')
      ? process.env.ESCC_AGENT_DATA_HOME : undefined,
    queue: Object.prototype.hasOwnProperty.call(process.env, 'ESCC_NOTIFY_QUEUE')
      ? process.env.ESCC_NOTIFY_QUEUE : undefined,
    desktop: Object.prototype.hasOwnProperty.call(process.env, 'ESCC_NOTIFY_NO_DESKTOP')
      ? process.env.ESCC_NOTIFY_NO_DESKTOP : undefined,
  };
  process.env.ESCC_AGENT_DATA_HOME = dir;
  delete process.env.ESCC_NOTIFY_QUEUE; // use the state-dir-derived path
  process.env.ESCC_NOTIFY_NO_DESKTOP = '1';
  try {
    return fn(dir);
  } finally {
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('ESCC_AGENT_DATA_HOME', saved.home);
    restore('ESCC_NOTIFY_QUEUE', saved.queue);
    restore('ESCC_NOTIFY_NO_DESKTOP', saved.desktop);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('run is non-blocking and routes a session-complete record through notify.js', () => {
  withTempStateDir(() => {
    const result = hook.run(JSON.stringify({
      hook_event_name: 'Stop',
      last_assistant_message: 'Finished porting the cost-tracker hook.\nMore detail here.',
    }));
    assert.ok(result && result.exitCode === 0, 'desktop-notify is non-blocking (exit 0)');

    const queued = drainNotifications();
    assert.equal(queued.length, 1, 'high severity queues exactly one record');
    assert.equal(queued[0].severity, 'high');
    assert.equal(queued[0].message, 'Finished porting the cost-tracker hook.',
      'summary is the first non-empty line of the last assistant message');
  });
});

test('run falls back to "Done" when there is no assistant message', () => {
  withTempStateDir(() => {
    const result = hook.run(JSON.stringify({ hook_event_name: 'Stop' }));
    assert.ok(result && result.exitCode === 0);
    const queued = drainNotifications();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].message, 'Done');
  });
});

test('run never throws on malformed input (fail open)', () => {
  withTempStateDir(() => {
    const result = hook.run('}{ not json');
    assert.ok(result && result.exitCode === 0);
  });
});

test('extractSummary: truncates long first lines and trims blanks', () => {
  assert.equal(hook.extractSummary(''), 'Done');
  assert.equal(hook.extractSummary(null), 'Done');
  assert.equal(hook.extractSummary('   \n\n  hello  \nworld'), 'hello');

  const long = 'x'.repeat(250);
  const summary = hook.extractSummary(long);
  assert.ok(summary.endsWith('...'));
  assert.ok(summary.length <= 103, 'truncated to MAX_BODY_LENGTH + ellipsis');
});
