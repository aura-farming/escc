'use strict';

/*
 * Unit tests for the CI security scanners in scripts/ci/lib/text-scan.js:
 *   - findBannedTokens — the de-companyfication word-boundary matcher (E4)
 *   - findSecrets      — committed-credential signatures (E1)
 *
 * Uses neutral example tokens ('cat', 'acme') so this file carries no real
 * banned token. It IS exempt from validate-no-secrets (it contains fixture
 * secret shapes by design), but it needs no exemption from the company-token
 * scan because it never mentions a real banned brand.
 */

const { findBannedTokens, findSecrets } = require('../../scripts/ci/lib/text-scan');

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
