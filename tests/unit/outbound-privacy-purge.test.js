'use strict';

/**
 * privacy-purge (GDPR erasure) must cover the v1.1.0 stores that hold recipient
 * PII: the do-not-contact blocklist and the outbound approval/decision rows in
 * governance_events. Hermetic: fresh ESCC_AGENT_DATA_HOME + ESCC_INSTINCT_HOME.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const purgeLib = require('../../scripts/lib/privacy-purge');
const review = require('../../scripts/lib/outbound-review');
const dnc = require('../../scripts/lib/do-not-contact');

function freshDir(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
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

test('privacy-purge erases the subject\'s do-not-contact + outbound approval rows', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshDir('escc-purge-'), ESCC_INSTINCT_HOME: freshDir('escc-purge-inst-') }, () => {
    const key = review.outboundContentKey({ to: 'sam@acme.com', subject: 'Hi', body: 'B' });
    review.recordApproval({ key, recipient: 'sam@acme.com', confidence: 1 });
    dnc.recordDoNotContact({ key: 'sam@acme.com', reason: 'asked us to stop' });

    const r = purgeLib.purge({ identifier: 'sam@acme.com', confirm: true });
    assert.ok(r.erased.doNotContactRemoved >= 1, 'the blocklist row is erased');
    assert.ok(r.erased.governanceRemoved >= 1, 'the approval row (recipient PII) is erased');
    assert.equal(dnc.findActiveBlock({ key: 'sam@acme.com' }), null, 'no block remains after erasure');
    assert.equal(review.findValidApproval({ key }), null, 'no approval remains after erasure');
  });
});

test('privacy-purge leaves an unrelated subject\'s outbound rows intact', () => {
  withEnv({ ESCC_AGENT_DATA_HOME: freshDir('escc-purge2-'), ESCC_INSTINCT_HOME: freshDir('escc-purge2-inst-') }, () => {
    dnc.recordDoNotContact({ key: 'keep@other.com', reason: 'declined' });
    const r = purgeLib.purge({ identifier: 'sam@acme.com', confirm: true });
    assert.equal(r.erased.doNotContactRemoved, 0, 'unrelated block is untouched');
    assert.ok(dnc.findActiveBlock({ key: 'keep@other.com' }), 'unrelated block still active');
  });
});
