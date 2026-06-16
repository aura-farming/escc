'use strict';

/*
 * Tests for scripts/lib/auto-update.js — `escc auto-update` (spec §6.6:
 * "git pull + reapply"). Adapted from ECC's auto-update, but ESCC reapplies
 * IN-PROCESS via repairInstalledStates (rebuilds each plan from the recorded
 * install-state request against the freshly-pulled source) instead of shelling
 * out to an install-apply subprocess.
 *
 * The git step is injectable (`exec`) so these tests never touch a real repo,
 * and --dry-run is proven to skip git entirely.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor.js');
const autoUpdate = require('../../scripts/lib/auto-update.js');

function makeFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-au-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-au-home-'));
  fs.mkdirSync(path.join(repo, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'escc', version: '0.1.0' })}\n`);
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-modules.json'),
    JSON.stringify({ version: 1, modules: [
      { id: 'rules-core', kind: 'rules', description: 'rules', paths: ['rules'], targets: ['claude', 'claude-project'], dependencies: [], defaultInstall: true, cost: 'light', stability: 'stable' },
    ] }, null, 2)
  );
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-profiles.json'),
    JSON.stringify({ version: 1, profiles: { core: { description: 'core', modules: ['rules-core'] } } }, null, 2)
  );
  fs.writeFileSync(path.join(repo, 'manifests', 'install-components.json'), JSON.stringify({ version: 1, components: [] }, null, 2));
  fs.mkdirSync(path.join(repo, 'rules', 'common'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rules', 'common', 'base.md'), '# base\n');

  const managedFile = path.join(home, '.claude', 'rules', 'escc', 'common', 'base.md');
  return {
    repo,
    home,
    managedFile,
    install() {
      applyInstallPlan(createManifestInstallPlan({ sourceRoot: repo, homeDir: home, target: 'claude', profileId: 'core' }));
    },
    cleanup() {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test('dry-run reports intent and skips git entirely', () => {
  const fx = makeFixture();
  try {
    fx.install();
    const gitCalls = [];
    const res = autoUpdate.runAutoUpdate({ repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'], dryRun: true, exec: (c, a) => { gitCalls.push([c, ...a]); return { status: 0 }; } });
    assert.equal(res.code, 0);
    assert.equal(res.data.dryRun, true);
    assert.equal(res.data.pulled, false);
    assert.equal(gitCalls.length, 0, 'dry-run never invokes git');
    assert.deepEqual(res.data.targets, ['claude']);
    assert.ok(/dry run/i.test(res.text));
  } finally {
    fx.cleanup();
  }
});

test('no install-state in context is a clean no-op (no git, no reapply)', () => {
  const fx = makeFixture();
  try {
    const gitCalls = [];
    const res = autoUpdate.runAutoUpdate({ repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'], exec: (c, a) => { gitCalls.push([c, ...a]); return { status: 0 }; } });
    assert.equal(res.code, 0);
    assert.equal(res.data.pulled, false);
    assert.equal(gitCalls.length, 0, 'nothing to update -> git not run');
    assert.ok(/nothing to update/i.test(res.text));
  } finally {
    fx.cleanup();
  }
});

test('a full update pulls then reapplies, restoring a drifted managed file', () => {
  const fx = makeFixture();
  try {
    fx.install();
    fs.rmSync(fx.managedFile); // simulate drift since the last install
    assert.equal(fs.existsSync(fx.managedFile), false);

    const gitCalls = [];
    const res = autoUpdate.runAutoUpdate({ repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'], exec: (c, a) => { gitCalls.push([c, ...a]); return { status: 0, stdout: '' }; } });

    assert.equal(res.code, 0);
    assert.equal(res.data.pulled, true);
    assert.ok(gitCalls.some(c => c.includes('pull')), 'git pull was invoked');
    assert.equal(fs.existsSync(fx.managedFile), true, 'reapply restored the managed file');
  } finally {
    fx.cleanup();
  }
});

test('a git pull failure aborts before reapply (fails closed on the pull)', () => {
  const fx = makeFixture();
  try {
    fx.install();
    fs.rmSync(fx.managedFile);
    const res = autoUpdate.runAutoUpdate({
      repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'],
      exec: (c, a) => { if (a.includes('pull')) throw new Error('network down'); return { status: 0 }; },
    });
    assert.equal(res.code, 1, 'non-zero on a failed pull');
    assert.ok(/git pull/i.test(res.text));
    assert.equal(res.data.pulled, false);
    assert.equal(fs.existsSync(fx.managedFile), false, 'no reapply happened after a failed pull');
  } finally {
    fx.cleanup();
  }
});
