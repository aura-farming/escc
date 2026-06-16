#!/usr/bin/env node
'use strict';

/*
 * Validate manifests/install-*.json: schema conformance plus profile / module /
 * component relationships (CLAUDE.md §1 manifests, §6 quality gate).
 *
 * Two views:
 *  - RAW (hand-authored JSON): schema-validated; every module `path` must exist
 *    on disk; no duplicate ids, self-deps, or double-claimed paths.
 *  - RESOLVED (loadInstallManifests, synthetic-inclusive): the per-skill
 *    skill-<id> modules / skill:<id> components the loader generates. Profile and
 *    component module references are checked against THIS set, so methodology
 *    components that point at synthetic skill modules resolve correctly.
 */

const fs = require('fs');
const path = require('path');
const Ajv = (m => m.default || m)(require('ajv'));
const { loadInstallManifests } = require('../lib/install-manifests');

const ROOT = path.join(__dirname, '..', '..');
const RAW = {
  modules: { json: 'manifests/install-modules.json', schema: 'schemas/install-modules.schema.json' },
  profiles: { json: 'manifests/install-profiles.json', schema: 'schemas/install-profiles.schema.json' },
  components: { json: 'manifests/install-components.json', schema: 'schemas/install-components.schema.json' },
};
const EXPECTED_PROFILES = ['sdr', 'ae', 'sales-manager', 'revops', 'full'];
const FAMILY_PREFIXES = {
  persona: 'persona:',
  capability: 'capability:',
  methodology: 'methodology:',
  skill: 'skill:',
};

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function main() {
  if (!fs.existsSync(path.join(ROOT, RAW.modules.json)) || !fs.existsSync(path.join(ROOT, RAW.profiles.json))) {
    console.log('Install manifests not found, skipping validation');
    process.exit(0);
  }

  const errors = [];
  const fail = msg => errors.push(msg);

  // 1. Schema validation of the raw manifests.
  let rawModules;
  let rawComponentsPresent = fs.existsSync(path.join(ROOT, RAW.components.json));
  try {
    rawModules = readJson(RAW.modules.json);
    const ajv = new Ajv({ allErrors: true, strict: false });
    const specs = rawComponentsPresent ? ['modules', 'profiles', 'components'] : ['modules', 'profiles'];
    for (const key of specs) {
      const data = readJson(RAW[key].json);
      const validate = ajv.compile(readJson(RAW[key].schema));
      if (!validate(data)) {
        for (const err of validate.errors) fail(`${RAW[key].json} schema: ${err.instancePath || '/'} ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }

  // 2. Hand-authored modules: paths exist, no dup ids / self-deps / double-claims.
  const handModules = Array.isArray(rawModules.modules) ? rawModules.modules : [];
  const handIds = new Set();
  const claimedPaths = new Map();
  for (const module of handModules) {
    if (handIds.has(module.id)) fail(`duplicate module id: ${module.id}`);
    handIds.add(module.id);

    for (const dep of module.dependencies || []) {
      if (dep === module.id) fail(`module ${module.id} cannot depend on itself`);
    }

    for (const rawPath of module.paths || []) {
      const norm = String(rawPath).replace(/\\/g, '/').replace(/\/+$/, '');
      if (!fs.existsSync(path.join(ROOT, norm))) fail(`module ${module.id} references missing path: ${norm}`);
      if (claimedPaths.has(norm)) fail(`path ${norm} is claimed by both ${claimedPaths.get(norm)} and ${module.id}`);
      else claimedPaths.set(norm, module.id);
    }
  }

  // 3. Resolved (synthetic-inclusive) view for reference resolution.
  let manifests;
  try {
    manifests = loadInstallManifests();
  } catch (err) {
    console.error(`ERROR: loadInstallManifests failed: ${err.message}`);
    process.exit(1);
  }
  const resolvedIds = manifests.modulesById;

  for (const module of handModules) {
    for (const dep of module.dependencies || []) {
      if (!resolvedIds.has(dep)) fail(`module ${module.id} depends on unknown module ${dep}`);
    }
  }

  // 4. Profiles: required ids present; module references resolve; no dupes.
  const profiles = manifests.profiles || {};
  for (const id of EXPECTED_PROFILES) {
    if (!profiles[id]) fail(`missing required install profile: ${id}`);
  }
  for (const [profileId, profile] of Object.entries(profiles)) {
    const seen = new Set();
    for (const moduleId of profile.modules || []) {
      if (!resolvedIds.has(moduleId)) fail(`profile ${profileId} references unknown module ${moduleId}`);
      if (seen.has(moduleId)) fail(`profile ${profileId} duplicates module ${moduleId}`);
      seen.add(moduleId);
    }
  }

  // 5. full profile completeness: every installable hand-authored module is in full.
  if (profiles.full) {
    const full = new Set(profiles.full.modules || []);
    for (const module of handModules) {
      if (module.kind === 'docs' && module.defaultInstall === false) continue;
      if (!full.has(module.id)) fail(`full profile is missing module ${module.id}`);
    }
  }

  // 6. Components: valid family + prefix; module references resolve; no dupes.
  const components = manifests.components || [];
  const componentIds = new Set();
  for (const component of components) {
    if (componentIds.has(component.id)) fail(`duplicate component id: ${component.id}`);
    componentIds.add(component.id);

    const prefix = FAMILY_PREFIXES[component.family];
    if (!prefix) fail(`component ${component.id} has unknown family "${component.family}"`);
    else if (!component.id.startsWith(prefix)) fail(`component ${component.id} does not match ${component.family} prefix "${prefix}"`);

    const seen = new Set();
    for (const moduleId of component.modules || []) {
      if (!resolvedIds.has(moduleId)) fail(`component ${component.id} references unknown module ${moduleId}`);
      if (seen.has(moduleId)) fail(`component ${component.id} duplicates module ${moduleId}`);
      seen.add(moduleId);
    }
  }

  if (errors.length > 0) {
    for (const err of errors) console.error(`ERROR: ${err}`);
    console.error(`validate-manifests: FAIL (${errors.length} error${errors.length === 1 ? '' : 's'})`);
    process.exit(1);
  }

  console.log(
    `Validated ${handModules.length} hand-authored modules (${manifests.modules.length} resolved), ` +
    `${components.length} components, ${Object.keys(profiles).length} profiles`
  );
  process.exit(0);
}

main();
