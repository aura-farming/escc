'use strict';

/*
 * Unit tests for scripts/lib/session-bridge.js.
 *
 * The metrics bridge file lives in os.tmpdir() as escc-metrics-<id>.json.
 * Writing then reading it must round-trip, and the path must be namespaced.
 */

const fs = require('fs');

const {
  getBridgePath,
  writeBridgeAtomic,
  readBridge,
  sanitizeSessionId,
} = require('../../scripts/lib/session-bridge.js');

test('session-bridge: write then read round-trips bridge data', () => {
  const sessionId = sanitizeSessionId(`test-${process.pid}-${Date.now()}`);
  assert.ok(sessionId, 'sanitizeSessionId should produce a usable id');
  const bridgePath = getBridgePath(sessionId);

  const payload = { cost: 1.23, tokens: 4567, model: 'opus' };
  try {
    writeBridgeAtomic(sessionId, payload);

    const onDisk = readBridge(sessionId);
    assert.ok(onDisk, 'readBridge should return the written data');
    assert.equal(onDisk.cost, 1.23);
    assert.equal(onDisk.tokens, 4567);
    assert.equal(onDisk.model, 'opus');
  } finally {
    try { fs.unlinkSync(bridgePath); } catch { /* ignore */ }
  }
});

test('session-bridge: bridge path is namespaced with escc-metrics-', () => {
  const bridgePath = getBridgePath('abc123');
  assert.ok(
    bridgePath.includes('escc-metrics-'),
    `bridge path should contain "escc-metrics-": ${bridgePath}`
  );
  assert.ok(bridgePath.endsWith('escc-metrics-abc123.json'));
});

test('session-bridge: readBridge returns null when the bridge file is absent', () => {
  const missing = sanitizeSessionId(`missing-${process.pid}-${Date.now()}`);
  assert.equal(readBridge(missing), null);
});

test('session-bridge: sanitizeSessionId rejects path traversal', () => {
  assert.equal(sanitizeSessionId('../escape'), null);
  assert.equal(sanitizeSessionId('a/b'), null);
  assert.equal(sanitizeSessionId('a\\b'), null);
});
