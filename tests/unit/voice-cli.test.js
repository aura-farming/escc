'use strict';

/*
 * Tests for the `escc voice` operator verb (ADR-0015) — the production entry
 * point that turns BUYER text into a per-account STYLE overlay. Hermetic: each
 * case points ESCC_AGENT_DATA_HOME at a fresh tmpdir and feeds buyer texts via
 * --input (the MCP-free contract — the orchestrator gathers the buyer side).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = require('../../scripts/escc');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escc-voicecli-'));
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

function writeInput(home, payload) {
  const p = path.join(home, 'buyer-texts.json');
  fs.writeFileSync(p, JSON.stringify(payload));
  return p;
}

test('voice account builds an overlay from buyer texts via --input', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const input = writeInput(home, {
      texts: [
        'Invoicing accuracy is our priority. Invoicing drives the rollout.',
        'We need reporting and invoicing aligned before go-live.',
      ],
    });
    const res = cli.run(['voice', 'account', 'domain:company.test', '--input', input]);
    assert.equal(res.code, 0);
    assert.ok(/voice overlay for domain:company.test/i.test(res.text));
    assert.ok(res.data.register.lexicon.includes('invoicing'));

    const file = path.join(home, 'escc', 'voice', 'account', 'domain_company.test.md');
    assert.ok(fs.existsSync(file), 'overlay written at the sanitized account path');
    assert.ok(fs.readFileSync(file, 'utf8').includes('STYLE OVERLAY ONLY'));
  });
});

test('voice account never lets a buyer claim/number into the overlay', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    const input = writeInput(home, { texts: ['We will cut invoicing costs by 47% and save $2.3M.'] });
    const res = cli.run(['voice', 'account', 'example-co', '--input', input]);
    assert.equal(res.code, 0);
    const md = fs.readFileSync(path.join(home, 'escc', 'voice', 'account', 'example-co.md'), 'utf8');
    assert.ok(!md.includes('47%') && !md.includes('$2.3M') && !md.includes('2.3'), 'no claim/number leaks into the overlay');
  });
});

test('voice show prints the overlay, or a hint when none exists', () => {
  const home = freshHome();
  withEnv({ ESCC_AGENT_DATA_HOME: home }, () => {
    assert.ok(/no voice overlay/i.test(cli.run(['voice', 'show', 'ghost']).text));

    const input = writeInput(home, { texts: ['Hi there. Reporting matters to us.'] });
    cli.run(['voice', 'account', 'example-co', '--input', input]);
    const shown = cli.run(['voice', 'show', 'example-co']);
    assert.equal(shown.code, 0);
    assert.ok(shown.text.includes('# Account voice overlay: example-co'));
  });
});

test('voice with a missing/unknown action or id is refused', () => {
  assert.equal(cli.run(['voice', 'account']).code, 1, 'account requires an id');
  assert.equal(cli.run(['voice', 'show']).code, 1, 'show requires an id');
  assert.equal(cli.run(['voice', 'bogus']).code, 1, 'unknown action refused');
  assert.ok(/unknown action/i.test(cli.run(['voice', 'bogus']).text));
});

test('help advertises the voice verb', () => {
  assert.ok(/voice account/.test(cli.run(['help']).text));
});
