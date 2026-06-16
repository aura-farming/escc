'use strict';

/*
 * Tests for scripts/install.js — the plan+apply installer orchestrator that
 * scripts/escc.js mounts as its `install` / `plan` subcommands. The heavy
 * lifting (manifest resolution, namespaced operations, apply) lives in the
 * already-tested install-* libs; install.js is the thin, uniform-contract
 * ({code,text,data}) wrapper. These tests exercise it end-to-end against a
 * hermetic fixture repo + target home (all under tmpdir).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const installer = require('../../scripts/install.js');

// Minimal but realistic fixture repo (manifests + content) + empty target home.
function makeFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-inst-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-inst-home-'));

  fs.mkdirSync(path.join(repo, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'escc', version: '0.1.0' })}\n`);
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-modules.json'),
    JSON.stringify({
      version: 1,
      modules: [
        { id: 'rules-core', kind: 'rules', description: 'rules', paths: ['rules'], targets: ['claude', 'claude-project'], dependencies: [], defaultInstall: true, cost: 'light', stability: 'stable' },
      ],
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-profiles.json'),
    JSON.stringify({ version: 1, profiles: { core: { description: 'core', modules: ['rules-core'] } } }, null, 2)
  );
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-components.json'),
    JSON.stringify({ version: 1, components: [] }, null, 2)
  );
  fs.mkdirSync(path.join(repo, 'rules', 'common'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rules', 'common', 'base.md'), '# base\n');

  return {
    repo,
    home,
    statePath: path.join(home, '.claude', 'escc', 'install-state.json'),
    cleanup() {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test('runPlan resolves a plan but writes nothing to disk (dry-run)', () => {
  const fx = makeFixture();
  try {
    const res = installer.runPlan({ sourceRoot: fx.repo, homeDir: fx.home, target: 'claude', profileId: 'core' });
    assert.equal(res.code, 0);
    assert.ok(res.data.plan.operations.length > 0, 'plan has operations');
    assert.ok(/dry run/i.test(res.text), 'text marks it as a dry run');
    assert.equal(fs.existsSync(fx.statePath), false, 'no install-state written by a plan');
  } finally {
    fx.cleanup();
  }
});

test('runInstall applies the plan: install-state + managed files land on disk', () => {
  const fx = makeFixture();
  try {
    const res = installer.runInstall({ sourceRoot: fx.repo, homeDir: fx.home, target: 'claude', profileId: 'core' });
    assert.equal(res.code, 0);
    assert.equal(fs.existsSync(fx.statePath), true, 'install-state written');
    const managed = path.join(fx.home, '.claude', 'rules', 'escc', 'common', 'base.md');
    assert.equal(fs.existsSync(managed), true, 'namespaced rule file installed');
  } finally {
    fx.cleanup();
  }
});

test('runInstall with dryRun writes nothing (delegates to plan)', () => {
  const fx = makeFixture();
  try {
    const res = installer.runInstall({ sourceRoot: fx.repo, homeDir: fx.home, target: 'claude', profileId: 'core', dryRun: true });
    assert.equal(res.code, 0);
    assert.equal(fs.existsSync(fx.statePath), false, 'dry-run install writes no state');
  } finally {
    fx.cleanup();
  }
});

test('an unsupported target is refused cleanly (no throw, non-zero code)', () => {
  const fx = makeFixture();
  try {
    const res = installer.runInstall({ sourceRoot: fx.repo, homeDir: fx.home, target: 'emacs', profileId: 'core' });
    assert.equal(res.code, 1, 'non-zero exit signals refusal');
    assert.ok(/target/i.test(res.text), 'explains the bad target');
    assert.equal(fs.existsSync(fx.statePath), false, 'nothing written on refusal');
  } finally {
    fx.cleanup();
  }
});

test('a value flag with no argument is refused', () => {
  const res = installer.run(['--target']);
  assert.equal(res.code, 1);
  assert.ok(/requires a value/i.test(res.text));
});
