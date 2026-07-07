'use strict';

/*
 * Tests for scripts/lib/account-identity (ADR-0018) — the canonical account
 * key every per-account store joins on. Hermetic: fresh ESCC_AGENT_DATA_HOME
 * per case.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const identity = require('../../scripts/lib/account-identity');
const mem = require('../../scripts/lib/account-memory');
const overlay = require('../../scripts/lib/voice-overlay');
const { createStateStoreSync } = require('../../scripts/lib/state-store/index.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-identity-'));
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

// --- grammar canonicalization -------------------------------------------------

test('canonicalizeInput: HubSpot company ids are tier-1 authority', () => {
  assert.deepEqual(identity.canonicalizeInput('company:12345'), { key: 'company_12345', tier: 'company' });
  assert.deepEqual(identity.canonicalizeInput('12345'), { key: 'company_12345', tier: 'company' });
  assert.deepEqual(identity.canonicalizeInput('company_12345'), { key: 'company_12345', tier: 'company' });
});

test('canonicalizeInput: domains, emails, and www all collapse to one domain key', () => {
  assert.equal(identity.canonicalizeInput('acme.example').key, 'domain_acme.example');
  assert.equal(identity.canonicalizeInput('www.acme.example').key, 'domain_acme.example');
  assert.equal(identity.canonicalizeInput('domain:acme.example').key, 'domain_acme.example');
  assert.equal(identity.canonicalizeInput('jane.doe@acme.example').key, 'domain_acme.example');
  assert.equal(identity.canonicalizeInput('domain_acme.example').key, 'domain_acme.example', 'idempotent over own output');
});

test('canonicalizeInput: deals and names keep their legacy stems (lossy tiers)', () => {
  assert.deepEqual(identity.canonicalizeInput('deal:7788'), { key: 'deal_7788', tier: 'deal' });
  assert.deepEqual(identity.canonicalizeInput('Example Co Pty Ltd'), { key: 'example_co_pty_ltd', tier: 'name' });
  assert.equal(identity.canonicalizeInput('').key, null);
  assert.equal(identity.canonicalizeInput(null).key, null);
});

// --- alias index ---------------------------------------------------------------

test('linkAlias + resolveAccountKey: a linked name resolves to the canonical key', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const linked = identity.linkAlias('Example Co Pty Ltd', 'company:12345');
    assert.deepEqual(linked, { alias: 'example_co_pty_ltd', canonical: 'company_12345', tier: 'company' });

    const r = identity.resolveAccountKey('Example Co Pty Ltd');
    assert.equal(r.key, 'company_12345');
    assert.equal(r.tier, 'alias');
    assert.equal(r.via, 'example_co_pty_ltd');

    // Unlinked ids still canonicalize by grammar.
    assert.equal(identity.resolveAccountKey('globex.example').key, 'domain_globex.example');
  });
});

test('a canonical key itself can be re-linked forward (one hop, domain -> company)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    identity.linkAlias('domain:acme.example', 'company:12345');
    assert.equal(identity.resolveAccountKey('acme.example').key, 'company_12345', 'bare domain follows the forward link');
    assert.equal(identity.resolveAccountKey('j@acme.example').key, 'company_12345', 'email follows too');
  });
});

test('alias cache invalidates on new links (mtime-keyed)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    assert.equal(identity.resolveAccountKey('Initech').key, 'initech', 'name tier before linking');
    identity.linkAlias('Initech', 'company:777');
    assert.equal(identity.resolveAccountKey('Initech').key, 'company_777', 'link visible immediately');
  });
});

test('linkAlias refuses unusable or self-referential links', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    assert.throws(() => identity.linkAlias('', 'company:1'));
    assert.throws(() => identity.linkAlias('acme', ''));
    assert.throws(() => identity.linkAlias('company:1', 'company:1'));
  });
});

test('equivalentStems returns the full identity cluster for purge', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    identity.linkAlias('Example Co Pty Ltd', 'company:12345');
    identity.linkAlias('domain:acme.example', 'company:12345');
    const stems = identity.equivalentStems('acme.example');
    assert.ok(stems.includes('company_12345'), 'canonical included');
    assert.ok(stems.includes('domain_acme.example'), 'domain stem included');
    assert.ok(stems.includes('example_co_pty_ltd'), 'sibling alias included');
    assert.ok(stems.includes('acme.example'), 'raw legacy stem included');
  });
});

// --- store integration ----------------------------------------------------------

test('account-memory + voice-overlay join on the canonical key once linked', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    identity.linkAlias('Example Co', 'company:12345');

    mem.appendEvent('Example Co', { type: 'note', text: 'met the CFO' });
    mem.appendEvent('company:12345', { type: 'note', text: 'sent pricing' });
    const events = mem.readEvents('acme.example'.replace('acme.example', 'Example Co')); // via alias
    assert.equal(events.length, 2, 'both writes landed in ONE canonical store');
    assert.ok(fs.existsSync(path.join(home, 'escc', 'accounts', 'company_12345.jsonl')));

    const file = overlay.writeOverlay('Example Co', { formality: 'neutral', lexicon: [], sampleCount: 0 });
    assert.ok(file.endsWith(path.join('voice', 'account', 'company_12345.md')), 'voice overlay keys canonically');
  });
});

test('legacy behavior unchanged for unlinked deal:/domain:/name ids', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    mem.appendEvent('deal:7788', { type: 'note', text: 'x' });
    assert.ok(fs.existsSync(path.join(home, 'escc', 'accounts', 'deal_7788.jsonl')));
    mem.appendEvent('domain:acme.test', { type: 'note', text: 'y' });
    assert.ok(fs.existsSync(path.join(home, 'escc', 'accounts', 'domain_acme.test.jsonl')));
  });
});

// --- backfill --------------------------------------------------------------------

test('backfill dry-run plans the merge; apply merges with backup; second run is empty', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    // Simulate the historical split: three fragments for one company.
    const accountsDir = path.join(home, 'escc', 'accounts');
    fs.mkdirSync(accountsDir, { recursive: true });
    fs.writeFileSync(path.join(accountsDir, 'acme.example.jsonl'),
      `${JSON.stringify({ id: 'e1', ts: '2026-01-01T00:00:00Z', type: 'note', account_id: 'acme.example', text: 'from bare-domain store' })}\n`);
    fs.writeFileSync(path.join(accountsDir, 'example_co_pty_ltd.jsonl'),
      `${JSON.stringify({ id: 'e2', ts: '2026-01-02T00:00:00Z', type: 'note', account_id: 'Example Co Pty Ltd', text: 'from name store' })}\n`);
    identity.linkAlias('Example Co Pty Ltd', 'company:12345');
    identity.linkAlias('domain:acme.example', 'company:12345');

    // Seed an open promise keyed on the legacy raw id.
    const store = createStateStoreSync();
    store.upsertPromise({ id: 'p1', account_id: 'acme.example', text: 'send the quote' });
    store.close();

    const plan = identity.backfillPlan();
    assert.equal(plan.empty, false);
    const group = plan.groups.find(g => g.canonical === 'company_12345');
    assert.ok(group, 'plan groups by canonical key');
    assert.deepEqual(group.accountStems.sort(), ['acme.example', 'example_co_pty_ltd']);
    assert.ok(plan.promiseUpdates.some(u => u.id === 'p1' && u.to === 'company_12345'));

    const result = identity.backfillApply(plan, { now: '2026-07-07T00:00:00.000Z' });
    assert.equal(result.mergedAccounts, 2);
    assert.ok(fs.existsSync(result.backupDir), 'backup dir written (reversible)');
    assert.ok(!fs.existsSync(path.join(accountsDir, 'acme.example.jsonl')), 'fragment removed after merge');

    const merged = mem.readEvents('company:12345');
    const texts = merged.map(e => e.text || '');
    assert.ok(texts.some(t => t.includes('from bare-domain store')), 'fragment events preserved');
    assert.ok(texts.some(t => t.includes('from name store')));
    assert.ok(merged.some(e => e.type === 'identity_backfill'), 'provenance event appended');

    const store2 = createStateStoreSync();
    const open = store2.listOpenPromises({ accountId: 'company_12345' });
    store2.close();
    assert.equal(open.length, 1, 'promise re-keyed to canonical');

    const plan2 = identity.backfillPlan();
    assert.equal(plan2.empty, true, 'idempotent: nothing left to merge');
  });
});

test('privacy-purge reaches the whole identity cluster (legacy stems + voice + alias rows)', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const purgeLib = require('../../scripts/lib/privacy-purge');
    identity.linkAlias('Example Co Pty Ltd', 'company:12345');
    identity.linkAlias('domain:acme.example', 'company:12345');
    mem.appendEvent('company:12345', { type: 'note', text: 'canonical store' });
    // A pre-backfill legacy fragment that only the cluster expansion can find.
    const accountsDir = path.join(home, 'escc', 'accounts');
    fs.writeFileSync(path.join(accountsDir, 'example_co_pty_ltd.jsonl'),
      `${JSON.stringify({ id: 'l1', type: 'note', account_id: 'Example Co Pty Ltd', text: 'legacy fragment' })}\n`);
    overlay.writeOverlay('company:12345', { formality: 'neutral', lexicon: ['invoicing'], sampleCount: 1 });

    const dry = purgeLib.purge({ identifier: 'acme.example', confirm: false });
    const files = dry.erased.accountFiles.map(p => path.basename(p));
    assert.ok(files.includes('company_12345.jsonl'), 'canonical jsonl in scope');
    assert.ok(files.includes('example_co_pty_ltd.jsonl'), 'sibling legacy fragment in scope');
    assert.ok(files.includes('company_12345.md'), 'voice overlay / md in scope');
    assert.ok(dry.erased.aliasRowsRemoved >= 2, 'alias rows counted');

    const done = purgeLib.purge({ identifier: 'acme.example', confirm: true });
    assert.ok(done.confirmed);
    assert.ok(!fs.existsSync(path.join(accountsDir, 'company_12345.jsonl')), 'canonical erased');
    assert.ok(!fs.existsSync(path.join(accountsDir, 'example_co_pty_ltd.jsonl')), 'legacy fragment erased');
    assert.equal(identity.listAliases().length, 0, 'alias rows erased');
  });
});

test('escc identity CLI: resolve, link, list, backfill dry-run/apply', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const cli = require('../../scripts/escc.js');
    assert.equal(cli.run(['identity', 'resolve']).code, 1, 'resolve requires an id');
    const named = cli.run(['identity', 'resolve', 'Example Co Pty Ltd']);
    assert.equal(named.code, 0);
    assert.match(named.text, /tier: name/);
    assert.match(named.text, /identity link/, 'lossy tier suggests linking');

    assert.equal(cli.run(['identity', 'link', 'Example Co Pty Ltd']).code, 1, 'link requires both args');
    const linked = cli.run(['identity', 'link', 'Example Co Pty Ltd', 'company:12345']);
    assert.equal(linked.code, 0);
    assert.match(cli.run(['identity', 'resolve', 'Example Co Pty Ltd']).text, /company_12345 \(tier: alias/);
    assert.match(cli.run(['identity', 'list']).text, /example_co_pty_ltd -> company_12345/);

    // Seed a fragment, then dry-run vs apply.
    fs.mkdirSync(path.join(home, 'escc', 'accounts'), { recursive: true });
    fs.writeFileSync(path.join(home, 'escc', 'accounts', 'example_co_pty_ltd.jsonl'),
      `${JSON.stringify({ id: 'x1', type: 'note', account_id: 'Example Co Pty Ltd', text: 'frag' })}\n`);
    const dry = cli.run(['identity', 'backfill']);
    assert.equal(dry.code, 0);
    assert.match(dry.text, /DRY RUN/);
    assert.ok(fs.existsSync(path.join(home, 'escc', 'accounts', 'example_co_pty_ltd.jsonl')), 'dry run writes nothing');
    const applied = cli.run(['identity', 'backfill', '--apply']);
    assert.equal(applied.code, 0);
    assert.match(applied.text, /Merged 1 account fragment/);
    assert.match(cli.run(['identity', 'backfill']).text, /nothing to merge/, 'idempotent');
    assert.equal(cli.run(['identity', 'bogus']).code, 1);
  });
});
