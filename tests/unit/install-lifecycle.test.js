'use strict';

/*
 * Integration tests for the ported installer subsystem, exercised end-to-end
 * against a hermetic fixture repo + target home (all under tmpdir).
 *
 * Flow proven here:
 *   manifests load -> resolveInstallPlan/createManifestInstallPlan (escc-namespaced
 *   operations) -> applyInstallPlan (files + install-state on disk) ->
 *   discoverInstalledStates -> buildDoctorReport (healthy) -> drift a managed file
 *   -> doctor reports error -> repairInstalledStates restores it -> doctor healthy
 *   -> uninstallInstalledStates removes managed files + state and prunes empties.
 *
 * This covers install-manifests, install-executor, install/apply, and the
 * install-lifecycle split (ops/operations/discovery/mutations + barrel) together.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor.js');
const {
  discoverInstalledStates,
  buildDoctorReport,
  repairInstalledStates,
  uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle.js');
const { listInstallComponents } = require('../../scripts/lib/install-manifests.js');

// Build a minimal but realistic fixture repo (manifests + source content + a skill)
// and an empty target home. Returns { repo, home, cleanup }.
function makeFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-home-'));

  fs.mkdirSync(path.join(repo, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'escc', version: '0.1.0' })}\n`);
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-modules.json'),
    JSON.stringify({
      version: 1,
      modules: [
        { id: 'rules-core', kind: 'rules', description: 'rules', paths: ['rules'], targets: ['claude', 'claude-project'], dependencies: [], defaultInstall: true, cost: 'light', stability: 'stable' },
        { id: 'docs-core', kind: 'docs', description: 'docs', paths: ['docs'], targets: ['claude', 'claude-project'], dependencies: ['rules-core'], defaultInstall: true, cost: 'light', stability: 'stable' },
      ],
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-profiles.json'),
    JSON.stringify({ version: 1, profiles: { core: { description: 'core', modules: ['rules-core', 'docs-core'] } } }, null, 2)
  );
  fs.writeFileSync(
    path.join(repo, 'manifests', 'install-components.json'),
    JSON.stringify({ version: 1, components: [] }, null, 2)
  );

  fs.mkdirSync(path.join(repo, 'rules', 'common'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'rules', 'common', 'base.md'), '# base\n');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'guide.md'), '# guide\n');
  fs.mkdirSync(path.join(repo, 'skills', 'demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'skills', 'demo-skill', 'SKILL.md'), '# demo\n');

  return {
    repo,
    home,
    cleanup() {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

function listFiles(dir, base = dir) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

test('installer: manifests expose a synthetic skill component scanned from skills/', () => {
  const fx = makeFixture();
  try {
    const components = listInstallComponents({ repoRoot: fx.repo });
    assert.ok(
      components.some(c => String(c.id).startsWith('skill:')),
      `expected a synthetic skill: component, got ${components.map(c => c.id)}`
    );
  } finally {
    fx.cleanup();
  }
});

test('installer: createManifestInstallPlan produces escc-namespaced operations', () => {
  const fx = makeFixture();
  try {
    const plan = createManifestInstallPlan({ sourceRoot: fx.repo, homeDir: fx.home, target: 'claude', profileId: 'core' });
    assert.equal(plan.targetRoot, path.join(fx.home, '.claude'));
    assert.equal(plan.installStatePath, path.join(fx.home, '.claude', 'escc', 'install-state.json'));
    assert.deepStrictEqual(plan.selectedModuleIds, ['rules-core', 'docs-core']);

    const byModule = Object.fromEntries(plan.operations.map(op => [op.moduleId, op]));
    // rules are remapped under the escc namespace; docs are copied verbatim.
    assert.ok(byModule['rules-core'].destinationPath.endsWith(path.join('rules', 'escc', 'common', 'base.md')));
    assert.ok(byModule['docs-core'].destinationPath.endsWith(path.join('docs', 'guide.md')));
    assert.ok(!byModule['docs-core'].destinationPath.includes(path.join('docs', 'escc')));
  } finally {
    fx.cleanup();
  }
});

test('installer: apply -> discover -> doctor -> drift -> repair -> uninstall round-trip', () => {
  const fx = makeFixture();
  try {
    const plan = createManifestInstallPlan({ sourceRoot: fx.repo, homeDir: fx.home, target: 'claude', profileId: 'core' });

    // APPLY
    applyInstallPlan(plan);
    assert.equal(fs.existsSync(plan.installStatePath), true, 'install-state written');
    const installed = listFiles(plan.targetRoot);
    assert.ok(installed.includes(path.join('rules', 'escc', 'common', 'base.md')), `rules namespaced: ${installed}`);
    assert.ok(installed.includes(path.join('docs', 'guide.md')), `docs verbatim: ${installed}`);

    // DISCOVER
    const records = discoverInstalledStates({ homeDir: fx.home, targets: ['claude'] });
    assert.equal(records.length, 1);
    assert.equal(records[0].exists, true);
    assert.equal(records[0].adapter.id, 'claude-home');

    // DOCTOR (healthy)
    const healthy = buildDoctorReport({ repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'] });
    assert.equal(healthy.summary.okCount, 1);
    assert.equal(healthy.summary.errorCount, 0);
    assert.equal(healthy.results[0].status, 'ok');

    // DRIFT: delete a managed file
    const victim = records[0].state.operations.find(op => op.kind === 'copy-file').destinationPath;
    fs.rmSync(victim);
    const drifted = buildDoctorReport({ repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'] });
    assert.equal(drifted.summary.errorCount, 1, 'doctor flags the missing managed file');
    assert.equal(drifted.results[0].status, 'error');

    // REPAIR
    const repair = repairInstalledStates({ repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'] });
    assert.equal(repair.summary.repairedCount, 1);
    assert.equal(fs.existsSync(victim), true, 'repair restored the managed file');
    const rechecked = buildDoctorReport({ repoRoot: fx.repo, homeDir: fx.home, targets: ['claude'] });
    assert.equal(rechecked.summary.okCount, 1, 'doctor healthy again after repair');

    // UNINSTALL
    const uninstall = uninstallInstalledStates({ homeDir: fx.home, targets: ['claude'] });
    assert.equal(uninstall.summary.uninstalledCount, 1);
    assert.equal(fs.existsSync(plan.installStatePath), false, 'install-state removed');
    assert.deepStrictEqual(listFiles(plan.targetRoot), [], 'managed files removed and empty dirs pruned');
  } finally {
    fx.cleanup();
  }
});
