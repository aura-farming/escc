'use strict';

/*
 * Unit tests for scripts/lib/notify.js.
 *
 * Hermetic: ESCC_AGENT_DATA_HOME is pointed at a fresh os.tmpdir() directory so
 * the notifications queue is written under a throwaway state dir, and desktop
 * delivery is disabled via ESCC_NOTIFY_NO_DESKTOP so the suite never pops a real
 * macOS/Linux notification. Each test cleans up its temp dir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  notify,
  drainNotifications,
  resolveQueuePath,
} = require('../../scripts/lib/notify.js');

function withTempStateDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-notify-'));
  const savedHome = Object.prototype.hasOwnProperty.call(process.env, 'ESCC_AGENT_DATA_HOME')
    ? process.env.ESCC_AGENT_DATA_HOME : undefined;
  const savedQueue = Object.prototype.hasOwnProperty.call(process.env, 'ESCC_NOTIFY_QUEUE')
    ? process.env.ESCC_NOTIFY_QUEUE : undefined;
  const savedDesktop = Object.prototype.hasOwnProperty.call(process.env, 'ESCC_NOTIFY_NO_DESKTOP')
    ? process.env.ESCC_NOTIFY_NO_DESKTOP : undefined;

  process.env.ESCC_AGENT_DATA_HOME = dir;
  delete process.env.ESCC_NOTIFY_QUEUE; // ensure we use the state-dir-derived path
  process.env.ESCC_NOTIFY_NO_DESKTOP = '1';

  try {
    return fn(dir);
  } finally {
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('ESCC_AGENT_DATA_HOME', savedHome);
    restore('ESCC_NOTIFY_QUEUE', savedQueue);
    restore('ESCC_NOTIFY_NO_DESKTOP', savedDesktop);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('notify: queue path is under the configured state dir', () => {
  withTempStateDir((dir) => {
    const queuePath = resolveQueuePath();
    assert.ok(queuePath.startsWith(dir), `queue path should live under the tmp state dir: ${queuePath}`);
    assert.ok(queuePath.endsWith('notifications.jsonl'));
  });
});

test('notify: low severity suppresses to a record only (never delivered)', () => {
  withTempStateDir(() => {
    const result = notify({ severity: 'low', title: 'low alert', message: 'fyi' });
    assert.equal(result.delivered.length, 0, 'low severity must not deliver');
    assert.equal(result.queued.length, 1, 'low severity records exactly one entry');
    assert.equal(result.queued[0].status, 'suppressed');
    assert.equal(result.queued[0].channel, 'digest');

    // Suppressed entries are NOT returned by a queued-only drain.
    const drained = drainNotifications();
    assert.equal(drained.length, 0, 'suppressed records must not be drained as queued work');
  });
});

test('notify: medium severity queues a digest entry', () => {
  withTempStateDir(() => {
    const result = notify({ severity: 'medium', title: 'medium alert', message: 'heads up' });
    assert.equal(result.queued.length, 1);
    assert.equal(result.queued[0].status, 'queued');
    assert.equal(result.queued[0].channel, 'digest');
  });
});

test('notify: drainNotifications returns queued entries', () => {
  withTempStateDir(() => {
    notify({ severity: 'medium', title: 'm1', message: 'one' });
    notify({ severity: 'medium', title: 'm2', message: 'two' });
    notify({ severity: 'low', title: 'l1', message: 'suppressed' });

    const drained = drainNotifications();
    assert.equal(drained.length, 2, 'only the two queued mediums should drain');
    assert.ok(drained.every(entry => entry.status === 'queued'));
    const titles = drained.map(entry => entry.title).sort();
    assert.deepEqual(titles, ['m1', 'm2']);

    // clear: true should truncate the queue.
    const drainedAgain = drainNotifications({ clear: true });
    assert.equal(drainedAgain.length, 2);
    const afterClear = drainNotifications();
    assert.equal(afterClear.length, 0, 'queue should be empty after a clearing drain');
  });
});
