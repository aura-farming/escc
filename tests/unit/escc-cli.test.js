'use strict';

/*
 * Tests for scripts/escc.js — the operator CLI dispatcher (spec §6.6 + §A.6).
 * These exercise the DISPATCH layer: argv parsing, routing to each of the 12
 * subcommands, the mounted instinct handlers, help, and unknown-command
 * refusal. The subcommands' deep behavior is covered by the libs' own tests;
 * here we prove escc.js wires them correctly and threads flags/positionals.
 *
 * Two hermetic surfaces:
 *   - install-family subcommands take explicit --repo-root / --home flags;
 *   - workspace subcommands (privacy-purge, watch, instinct-*) read the
 *     ESCC_AGENT_DATA_HOME / ESCC_INSTINCT_HOME / ESCC_REP_IDENTITY env.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const cli = require('../../scripts/escc.js');

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

function makeRepoFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-cli-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-cli-home-'));
  fs.mkdirSync(path.join(repo, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'escc', version: '0.1.0' })}\n`);
  fs.writeFileSync(path.join(repo, 'manifests', 'install-modules.json'), JSON.stringify({ version: 1, modules: [
    { id: 'rules-core', kind: 'rules', description: 'rules', paths: ['rules'], targets: ['claude', 'claude-project'], dependencies: [], defaultInstall: true, cost: 'light', stability: 'stable' },
  ] }, null, 2));
  fs.writeFileSync(path.join(repo, 'manifests', 'install-profiles.json'), JSON.stringify({ version: 1, profiles: { core: { description: 'core', modules: ['rules-core'] } } }, null, 2));
  fs.writeFileSync(path.join(repo, 'manifests', 'install-components.json'), JSON.stringify({ version: 1, components: [] }, null, 2));
  fs.mkdirSync(path.join(repo, 'rules', 'common'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rules', 'common', 'base.md'), '# base\n');
  return { repo, home, statePath: path.join(home, '.claude', 'escc', 'install-state.json'), cleanup() { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); } };
}

function freshWorkspaceEnv() {
  return {
    ESCC_AGENT_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-cli-ws-')),
    ESCC_INSTINCT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'escc-cli-inst-')),
    ESCC_REP_IDENTITY: 'rep-cli',
  };
}

const ALL_SUBCOMMANDS = ['install', 'plan', 'catalog', 'doctor', 'repair', 'status', 'sessions', 'list-installed', 'uninstall', 'auto-update', 'privacy-purge', 'watch'];

test('help advertises all 12 subcommands plus the instinct mounts', () => {
  const res = cli.run(['help']);
  assert.equal(res.code, 0);
  for (const cmd of ALL_SUBCOMMANDS) assert.ok(res.text.includes(cmd), `help lists ${cmd}`);
  assert.ok(/instinct-status/.test(res.text) && /evolve/.test(res.text), 'help lists the instinct mounts');
});

test('no arguments prints help (code 0)', () => {
  assert.equal(cli.run([]).code, 0);
});

test('an unknown command is refused with a non-zero code', () => {
  const res = cli.run(['definitely-not-a-subcommand']);
  assert.equal(res.code, 1);
  assert.ok(/unknown/i.test(res.text));
});

test('plan delegates to the installer (dry-run, writes nothing)', () => {
  const fx = makeRepoFixture();
  try {
    const res = cli.run(['plan', '--repo-root', fx.repo, '--home', fx.home, '--target', 'claude', '--profile', 'core']);
    assert.equal(res.code, 0);
    assert.ok(/dry run/i.test(res.text));
    assert.equal(fs.existsSync(fx.statePath), false, 'plan writes nothing');
  } finally {
    fx.cleanup();
  }
});

test('install applies, then list-installed and doctor see the managed target', () => {
  const fx = makeRepoFixture();
  try {
    const installed = cli.run(['install', '--repo-root', fx.repo, '--home', fx.home, '--target', 'claude', '--profile', 'core']);
    assert.equal(installed.code, 0);
    assert.equal(fs.existsSync(fx.statePath), true, 'install wrote install-state');

    const listed = cli.run(['list-installed', '--home', fx.home, '--target', 'claude']);
    assert.equal(listed.code, 0);
    assert.ok(/claude/.test(listed.text), 'list-installed names the target');

    const doctor = cli.run(['doctor', '--repo-root', fx.repo, '--home', fx.home, '--target', 'claude', '--exit-code']);
    assert.equal(doctor.code, 0, 'healthy install -> exit code 0 with --exit-code');
  } finally {
    fx.cleanup();
  }
});

test('catalog lists profiles/modules/components from the manifests', () => {
  const fx = makeRepoFixture();
  try {
    const res = cli.run(['catalog', '--repo-root', fx.repo]);
    assert.equal(res.code, 0);
    assert.ok(/core/.test(res.text), 'names the core profile');
    assert.ok(/rules-core/.test(res.text), 'names the rules-core module');
  } finally {
    fx.cleanup();
  }
});

test('auto-update --dry-run is wired and skips git', () => {
  const fx = makeRepoFixture();
  try {
    cli.run(['install', '--repo-root', fx.repo, '--home', fx.home, '--target', 'claude', '--profile', 'core']);
    const res = cli.run(['auto-update', '--dry-run', '--repo-root', fx.repo, '--home', fx.home, '--target', 'claude']);
    assert.equal(res.code, 0);
    assert.ok(/dry run/i.test(res.text));
  } finally {
    fx.cleanup();
  }
});

test('privacy-purge requires an identifier and otherwise dry-runs', () => {
  withEnv(freshWorkspaceEnv(), () => {
    assert.equal(cli.run(['privacy-purge']).code, 1, 'no identifier refused');
    const res = cli.run(['privacy-purge', 'acme.io']);
    assert.equal(res.code, 0);
    assert.ok(/dry run/i.test(res.text), 'defaults to a dry run (no --confirm)');
    assert.equal(res.data.confirmed, false);
  });
});

test('the instinct handlers are mounted (instinct-status, evolve)', () => {
  withEnv(freshWorkspaceEnv(), () => {
    assert.equal(cli.run(['instinct-status']).code, 0);
    assert.equal(cli.run(['evolve']).code, 0);
  });
});

test('watch is mounted and stays silent on an empty workspace', () => {
  withEnv(freshWorkspaceEnv(), () => {
    const res = cli.run(['watch']);
    assert.equal(res.code, 0);
    assert.ok(/no signals/i.test(res.text));
  });
});

test('a value flag with no argument is refused (no silent wrong default)', () => {
  const res = cli.run(['install', '--target']);
  assert.equal(res.code, 1);
  assert.ok(/requires a value/i.test(res.text), 'explains the missing flag value');
});

test('status --write surfaces a write failure instead of silently swallowing it', () => {
  withEnv(freshWorkspaceEnv(), () => {
    const badPath = path.join(os.tmpdir(), `escc-no-such-dir-${process.pid}`, 'nested', 'status.md');
    const res = cli.run(['status', '--write', badPath]);
    assert.ok(res.data.writeError, 'write failure captured in data.writeError');
    assert.ok(/could not write|warning/i.test(res.text), 'warning surfaced in text');
  });
});
