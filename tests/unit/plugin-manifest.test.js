'use strict';

/*
 * Phase 7 acceptance (spec §12): the local plugin marketplace entry point is
 * well-formed and internally consistent, so `/plugin marketplace add <local path>`
 * resolves the `escc` plugin and loads its skills/commands under the `escc:`
 * namespace. The marketplace-add itself is a Claude Code CLI action (confirmed
 * manually); this fixture proves the manifests it reads are valid + consistent,
 * which is the part that can regress silently (no other CI validates them).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('marketplace.json is valid and registers the escc plugin from the repo root', () => {
  const mkt = readJson('.claude-plugin/marketplace.json');
  assert.equal(mkt.name, 'escc', 'the marketplace is named escc');
  assert.ok(Array.isArray(mkt.plugins) && mkt.plugins.length >= 1, 'it declares at least one plugin');
  const escc = mkt.plugins.find(p => p.name === 'escc');
  assert.ok(escc, 'the escc plugin is registered');
  assert.equal(escc.source, './', 'the escc plugin source is the repo root');
});

test('plugin.json declares escc and points at the skills and commands directories', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'escc', 'the plugin is named escc (skills resolve as escc:<name>)');
  assert.ok(Array.isArray(plugin.skills) && plugin.skills.includes('./skills/'), 'the skills directory is referenced');
  assert.ok(Array.isArray(plugin.commands) && plugin.commands.includes('./commands/'), 'the commands directory is referenced');
});

test('plugin.json and marketplace.json agree on the escc name and version', () => {
  const mkt = readJson('.claude-plugin/marketplace.json');
  const plugin = readJson('.claude-plugin/plugin.json');
  const escc = mkt.plugins.find(p => p.name === 'escc');
  assert.equal(plugin.name, escc.name, 'plugin.json and marketplace.json agree on the name');
  assert.equal(plugin.version, escc.version, 'plugin.json and marketplace.json agree on the version');
});

test('the referenced skills and commands directories exist and are non-empty', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  for (const rel of [...plugin.skills, ...plugin.commands]) {
    const dir = path.join(ROOT, rel);
    assert.ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), rel + ' exists as a directory');
    assert.ok(fs.readdirSync(dir).length > 0, rel + ' is non-empty');
  }
});
