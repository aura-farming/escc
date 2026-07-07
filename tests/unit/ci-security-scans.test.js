'use strict';

/*
 * Unit tests for the CI security scanners in scripts/ci/lib/text-scan.js:
 *   - findBannedTokens   — the de-companyfication word-boundary matcher (E4)
 *   - findSecrets        — committed-credential signatures (E1)
 *   - findForeignEmails  — non-fixture email addresses (v1.8.1 anti-leak guard)
 * plus scope pins on the validators themselves: the public-source scanners
 * cover EVERY git-tracked file — no directory is exempt (the v1.8.1 lesson:
 * leaks hide precisely in the files a scan allowlist never reaches).
 *
 * Uses neutral example tokens ('cat', 'acme') so this file carries no real
 * banned token. It IS exempt from validate-no-secrets (it contains fixture
 * secret shapes by design), but it needs no exemption from the company-token
 * scan because it never mentions a real banned brand.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { findBannedTokens, findBannedTokenHashes, findForeignEmails, findSecrets } = require('../../scripts/ci/lib/text-scan');

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

const CI_DIR = path.join(__dirname, '..', '..', 'scripts', 'ci');

test('findBannedTokens: a word token matches standalone but never as a substring', () => {
  assert.deepEqual(findBannedTokens('the cat sat', ['cat']).map(h => h.toLowerCase()), ['cat']);
  assert.deepEqual(findBannedTokens('category concatenate scattered', ['cat']), [], 'must not trip on a containing word');
  assert.equal(findBannedTokens('a CAT and a Cat', ['cat']).length, 2, 'case-insensitive');
  assert.deepEqual(findBannedTokens('nothing relevant here', ['cat']), []);
});

test('findBannedTokens: a word token still matches inside emails and domains', () => {
  assert.equal(findBannedTokens('mail bob@acme.io now', ['acme']).length, 1, 'inside an email host');
  assert.equal(findBannedTokens('see https://help.acme.io/docs', ['acme']).length, 1, 'inside a domain');
});

test('findBannedTokens: a dotted token matches literally (the dot is not any-char)', () => {
  assert.equal(findBannedTokens('go to help.acme.io please', ['help.acme.io']).length, 1);
  assert.deepEqual(findBannedTokens('helpXacmeYio', ['help.acme.io']), []);
});

test('findBannedTokenHashes: matches a hashed word token with boundary semantics', () => {
  const hashes = [sha256('cat')];
  assert.deepEqual(findBannedTokenHashes('the cat sat', hashes), ['cat']);
  assert.deepEqual(findBannedTokenHashes('category concatenate scattered', hashes), [], 'no substring trips');
  assert.deepEqual(findBannedTokenHashes('a CAT here', hashes), ['cat'], 'case-insensitive via lowercase hashing');
  assert.deepEqual(findBannedTokenHashes('mail bob@cat.example now', hashes), ['cat'], 'word inside an email host still matches');
});

test('findBannedTokenHashes: matches a hashed host token label-aligned, incl. email hosts', () => {
  const hashes = [sha256('help.acme.example')];
  assert.deepEqual(findBannedTokenHashes('see https://help.acme.example/docs', hashes), ['help.acme.example']);
  assert.deepEqual(findBannedTokenHashes('mail sam@sub.help.acme.example now', hashes), ['help.acme.example'], 'suffix of a longer host');
  assert.deepEqual(findBannedTokenHashes('helpXacmeYexample', hashes), []);
});

test('findBannedTokenHashes: the shipped config self-documents without disclosing — hashes never self-trip', () => {
  const raw = fs.readFileSync(path.join(CI_DIR, '..', '..', 'config', 'banned-company-tokens.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.token_hashes) && parsed.token_hashes.length > 0, 'ships at least one hashed token');
  for (const h of parsed.token_hashes) assert.match(h, /^[0-9a-f]{64}$/);
  assert.deepEqual(parsed.tokens, [], 'no plaintext token ships in the public config');
  assert.deepEqual(findBannedTokenHashes(raw, parsed.token_hashes), [], 'the config file does not trip its own scan');
});

test('findSecrets: catches high-confidence credential signatures', () => {
  assert.ok(findSecrets('key = AKIA' + 'ABCDEFGHIJKLMNOP').some(h => /AWS/.test(h.type)), 'AWS key id');
  assert.ok(findSecrets('-----BEGIN OPENSSH PRIVATE KEY-----').some(h => /private key/.test(h.type)));
  assert.ok(findSecrets('token: ghp_' + 'a'.repeat(36)).some(h => /GitHub/.test(h.type)));
  assert.ok(findSecrets('AIza' + 'B'.repeat(35)).some(h => /Google/.test(h.type)));
});

test('findSecrets: a secret-named assignment with a long value is caught; placeholders are not', () => {
  assert.ok(findSecrets('api_key = "' + 'A1b2C3d4E5f6G7h8I9j0K1l2' + '"').some(h => /assignment/.test(h.type)), 'real-looking value caught');
  assert.deepEqual(findSecrets('access_token: "${HUBSPOT_ACCESS_TOKEN}"'), [], 'env placeholder not flagged');
  assert.deepEqual(findSecrets('api_key = "your-api-key-placeholder-here-xx"'), [], 'placeholder words not flagged');
});

test('findSecrets: ordinary code that merely uses the word token is not flagged', () => {
  assert.deepEqual(findSecrets('const recipientToken = hash(recipient + content);'), [], 'no literal value -> no hit');
  assert.deepEqual(findSecrets('a per-recipient approval token is recorded'), []);
});

test('findSecrets: the reported match is truncated so CI never echoes a full secret', () => {
  const hit = findSecrets('AIza' + 'C'.repeat(35))[0];
  assert.ok(hit && hit.match.endsWith('…'), 'truncation marker present');
  assert.ok(hit.match.length <= 26, 'match is short');
});

test('findForeignEmails: fixture domains, their subdomains, and RFC 2606 TLDs pass', () => {
  const allowed = ['acme.com', 'globex.io'];
  assert.deepEqual(findForeignEmails('mail jane@acme.com now', allowed), []);
  assert.deepEqual(findForeignEmails('ops@mail.globex.io replied', allowed), [], 'subdomain of a fixture domain');
  assert.deepEqual(findForeignEmails('you@yourco.example and qa@ci.test', []), [], 'reserved TLDs need no allowlist');
  assert.deepEqual(findForeignEmails('Jane@ACME.com shouted', allowed), [], 'case-insensitive');
});

test('findForeignEmails: a real-looking non-fixture address is caught, verbatim', () => {
  const leaks = findForeignEmails('contact sam.reed@northwindtraders.com today', ['acme.com']);
  assert.deepEqual(leaks, ['sam.reed@northwindtraders.com']);
  assert.equal(findForeignEmails('a@b.com c@b.com d@other.net', ['b.com']).length, 1, 'only the foreign one');
});

test('findForeignEmails: non-email text does not false-positive', () => {
  assert.deepEqual(findForeignEmails('install ajv@8.17.1 or ajv@latest; see @anthropic-ai/sdk', ['acme.com']), []);
  assert.deepEqual(findForeignEmails('no addresses here', []), []);
});

test('committed-email-domains config loads and holds lowercase bare domains', () => {
  const parsed = JSON.parse(fs.readFileSync(path.join(CI_DIR, '..', '..', 'config', 'committed-email-domains.json'), 'utf8'));
  assert.ok(Array.isArray(parsed.allowed_domains) && parsed.allowed_domains.length > 0);
  for (const d of parsed.allowed_domains) {
    assert.match(d, /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/, `"${d}" must be a bare lowercase domain`);
  }
});

test('scope pin: no public-source scan validator exempts a committed directory', () => {
  // The v1.8.1 guard: leaks hide in whatever the scanners skip (a root file
  // outside a directory allowlist; scaffolding under a prefix carve-out).
  // Committed = scanned, forever.
  for (const name of [
    'validate-no-personal-paths.js',
    'validate-no-secrets.js',
    'validate-no-company-tokens.js',
    'validate-committed-emails.js',
  ]) {
    const src = fs.readFileSync(path.join(CI_DIR, name), 'utf8');
    assert.ok(!src.includes('EXEMPT_PREFIXES'), `${name} must not carve out directories`);
    assert.ok(!/TARGETS\s*=/.test(src), `${name} must not scan from a directory allowlist`);
    assert.ok(/listTrackedFiles|ls-files/.test(src), `${name} must scan git-tracked files`);
  }
});
