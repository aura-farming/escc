'use strict';

/*
 * Tests for scripts/lib/account-memory — the canonical per-entity (account/deal)
 * memory store (A.2 C1/C5). Hermetic: each case points ESCC_AGENT_DATA_HOME at a
 * fresh tmpdir, so account files are isolated.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mem = require('../../scripts/lib/account-memory');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-accountmem-'));
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// --- id sanitization --------------------------------------------------------

test('sanitizeAccountId maps typed keys to safe filename stems', () => {
  assert.equal(mem.sanitizeAccountId('deal:7788'), 'deal_7788');
  assert.equal(mem.sanitizeAccountId('domain:Acme.IO'), 'domain_acme.io');
  assert.equal(mem.sanitizeAccountId('company:42'), 'company_42');
});

test('sanitizeAccountId rejects traversal and empties', () => {
  assert.equal(mem.sanitizeAccountId('../../etc/passwd'), 'etc_passwd');
  assert.ok(!String(mem.sanitizeAccountId('../../etc/passwd')).includes('..'));
  assert.equal(mem.sanitizeAccountId(''), null);
  assert.equal(mem.sanitizeAccountId(null), null);
});

// --- append + read round-trip ----------------------------------------------

test('appendEvent then readEvents round-trips, filling id/ts and storing original account_id', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const ev = mem.appendEvent('deal:7788', { type: 'note', text: 'Champion is the VP Eng' });
    assert.ok(ev.id, 'event id is filled');
    assert.ok(typeof ev.ts === 'string', 'event ts is filled');
    assert.equal(ev.account_id, 'deal:7788', 'original (unsanitized) account id is preserved on the record');

    const events = mem.readEvents('deal:7788');
    assert.equal(events.length, 1);
    assert.equal(events[0].text, 'Champion is the VP Eng');

    // The file is keyed by the sanitized stem.
    const fp = path.join(home, 'escc', 'accounts', 'deal_7788.jsonl');
    assert.ok(fs.existsSync(fp), 'jsonl file written at sanitized path');
  });
});

test('appendEvent throws on an unusable account id', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    assert.throws(() => mem.appendEvent('', { type: 'note', text: 'x' }));
  });
});

test('readEvents returns [] for an account with no file', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    assert.deepEqual(mem.readEvents('never-seen'), []);
  });
});

// --- hydrate folding --------------------------------------------------------

test('hydrate folds segment, deals, open loops and recent events', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    mem.appendEvent('acme', { type: 'segment', segment: 'enterprise', ts: '2026-06-01T00:00:00.000Z' });
    mem.appendEvent('acme', { type: 'deal', deal_id: 'deal-1', close_date: '2026-06-30', stage: 'negotiation', ts: '2026-06-02T00:00:00.000Z' });
    mem.appendEvent('acme', { type: 'loop', deal_id: 'deal-1', text: 'Send MSA redlines', status: 'open', ts: '2026-06-03T00:00:00.000Z' });
    mem.appendEvent('acme', { type: 'loop', text: 'Old loop', status: 'done', ts: '2026-06-04T00:00:00.000Z' });

    const h = mem.hydrate('acme');
    assert.equal(h.accountId, 'acme');
    assert.equal(h.segment, 'enterprise', 'segment folds from segment event');
    assert.ok(h.deals['deal-1'], 'deal folded by deal_id');
    assert.equal(h.deals['deal-1'].close_date, '2026-06-30');
    assert.equal(h.openLoops.length, 1, 'closed loops excluded from openLoops');
    assert.equal(h.openLoops[0].text, 'Send MSA redlines');
    assert.equal(h.eventCount, 4);
  });
});

test('renderDigest produces markdown and respects the char cap', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    for (let i = 0; i < 20; i++) {
      mem.appendEvent('acme', { type: 'note', text: `note number ${i} with some length to it`, ts: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` });
    }
    const h = mem.hydrate('acme');
    const full = mem.renderDigest(h);
    assert.ok(full.includes('acme'), 'digest names the account');
    const capped = mem.renderDigest(h, 120);
    assert.ok(capped.length <= 120, `capped digest within budget (was ${capped.length})`);
  });
});

// --- active account resolution ---------------------------------------------

test('resolveActiveAccount honors the ESCC_ACTIVE_ACCOUNT override', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: 'globex' }, () => {
    mem.appendEvent('globex', { type: 'deal', deal_id: 'deal-9', segment: 'mid-market' });
    const active = mem.resolveActiveAccount();
    assert.equal(active.accountId, 'globex');
    assert.equal(active.dealId, 'deal-9');
  });
});

test('resolveActiveAccount falls back to the most recently touched account', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    mem.appendEvent('first-co', { type: 'note', text: 'older' });
    mem.appendEvent('second-co', { type: 'deal', deal_id: 'deal-2', text: 'newer' });
    const active = mem.resolveActiveAccount();
    assert.equal(active.accountId, 'second-co', 'most recently written account wins');
    assert.equal(active.dealId, 'deal-2');
  });
});

test('resolveActiveAccount returns null when there is no memory', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home, ESCC_ACTIVE_ACCOUNT: undefined }, () => {
    assert.equal(mem.resolveActiveAccount(), null);
  });
});

// --- near-close deals -------------------------------------------------------

test('listNearCloseDeals returns deals closing within the window, excluding closed/won', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    mem.appendEvent('acme', { type: 'deal', deal_id: 'soon', close_date: '2026-06-20', stage: 'negotiation' });
    mem.appendEvent('globex', { type: 'deal', deal_id: 'far', close_date: '2026-12-31', stage: 'discovery' });
    mem.appendEvent('initech', { type: 'deal', deal_id: 'wonalready', close_date: '2026-06-18', status: 'closed' });

    const near = mem.listNearCloseDeals(14, { now: '2026-06-15T00:00:00.000Z' });
    const ids = near.map(d => d.deal_id);
    assert.ok(ids.includes('soon'), 'deal closing within window included');
    assert.ok(!ids.includes('far'), 'deal closing far out excluded');
    assert.ok(!ids.includes('wonalready'), 'closed deal excluded');
  });
});

// --- markdown handoff view (C5) --------------------------------------------

test('appendEvent refreshes a markdown companion view for handoff', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    mem.appendEvent('acme', { type: 'note', text: 'Champion identified' });
    const md = path.join(home, 'escc', 'accounts', 'acme.md');
    assert.ok(fs.existsSync(md), 'markdown handoff view written alongside jsonl');
    assert.ok(fs.readFileSync(md, 'utf8').includes('Champion identified'));
  });
});

test('a closing event of any type resolves a tracked loop by id (C3)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    mem.appendEvent('acme', { id: 'L1', type: 'loop', text: 'Send MSA', status: 'open', ts: '2026-06-01T00:00:00.000Z' });
    mem.appendEvent('acme', { id: 'L1', type: 'note', text: 'MSA sent', status: 'done', ts: '2026-06-02T00:00:00.000Z' });
    const h = mem.hydrate('acme');
    assert.ok(!h.openLoops.some(l => l.id === 'L1'), 'a done marker of a non-loop type still clears the loop');
  });
});

test('renderDigest never leaves a lone surrogate at the cut', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    mem.appendEvent('👍👍👍-co', { type: 'note', text: 'emoji account name' });
    const h = mem.hydrate('👍👍👍-co');
    for (let cap = 16; cap <= 40; cap++) {
      const out = mem.renderDigest(h, cap);
      assert.ok(out.length <= cap, `within cap ${cap}`);
      assert.ok(!/[\uD800-\uDBFF]$/.test(out.replace(/…$/, '')), `no lone surrogate at cap ${cap}`);
    }
  });
});
