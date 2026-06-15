'use strict';

/*
 * Unit tests for the trimmed install-targets registry (ported from ECC).
 *
 * ESCC ships exactly two install targets: claude-home (~/.claude) and
 * claude-project (<projectRoot>/.claude). Every other ECC target is dropped.
 * Covers: registry membership, adapter resolution, dropped-target rejection,
 * escc-namespaced install-state path, home-vs-project root resolution, and the
 * fail-closed validation when a project root is missing.
 */

const path = require('path');

const {
  getInstallTargetAdapter,
  listInstallTargetAdapters,
  planInstallTargetScaffold,
} = require('../../scripts/lib/install-targets/registry.js');

test('install-targets: registry holds exactly claude-home and claude-project', () => {
  const ids = listInstallTargetAdapters().map(a => a.id).sort();
  assert.deepStrictEqual(ids, ['claude-home', 'claude-project']);
});

test('install-targets: getInstallTargetAdapter resolves claude / claude-home / claude-project', () => {
  assert.equal(getInstallTargetAdapter('claude').id, 'claude-home');
  assert.equal(getInstallTargetAdapter('claude-home').id, 'claude-home');
  assert.equal(getInstallTargetAdapter('claude-project').id, 'claude-project');
});

test('install-targets: a dropped non-claude target throws', () => {
  assert.throws(() => getInstallTargetAdapter('cursor'), /Unknown install target adapter/);
});

test('install-targets: claude-home resolves under homeDir with an escc-namespaced state path', () => {
  const adapter = getInstallTargetAdapter('claude');
  assert.equal(adapter.resolveRoot({ homeDir: '/h' }), path.join('/h', '.claude'));
  assert.equal(
    adapter.getInstallStatePath({ homeDir: '/h' }),
    path.join('/h', '.claude', 'escc', 'install-state.json')
  );
});

test('install-targets: claude-project resolves under projectRoot', () => {
  const adapter = getInstallTargetAdapter('claude-project');
  assert.equal(adapter.resolveRoot({ projectRoot: '/p' }), path.join('/p', '.claude'));
  assert.equal(
    adapter.getInstallStatePath({ projectRoot: '/p' }),
    path.join('/p', '.claude', 'escc', 'install-state.json')
  );
});

test('install-targets: claude-project is fail-closed when no project root is supplied', () => {
  // planInstallTargetScaffold throws on any error-severity validation issue.
  assert.throws(() =>
    planInstallTargetScaffold({ target: 'claude-project', modules: [], homeDir: '/h' })
  );
});

test('install-targets: planOperations namespaces skills/ and rules/ but keeps docs/ verbatim', () => {
  const scaffold = planInstallTargetScaffold({
    target: 'claude',
    modules: [{ id: 'm', paths: ['skills', 'rules', 'docs'] }],
    repoRoot: '/repo',
    homeDir: '/h',
  });
  const dests = scaffold.operations.map(op => op.destinationPath);
  const nsSkills = path.join('skills', 'escc');
  const nsRules = path.join('rules', 'escc');
  assert.ok(dests.some(d => d.includes(nsSkills)), `skills namespaced under escc: ${dests}`);
  assert.ok(dests.some(d => d.includes(nsRules)), `rules namespaced under escc: ${dests}`);
  assert.ok(
    dests.some(d => d.includes(`${path.sep}docs`) && !d.includes(path.join('docs', 'escc'))),
    `docs copied verbatim (no escc segment): ${dests}`
  );
});
