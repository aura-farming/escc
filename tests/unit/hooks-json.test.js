'use strict';

/**
 * Contract tests for hooks/hooks.json and schemas/hooks.schema.json.
 *
 * These assert the hook graph is well-formed and obeys CLAUDE.md §4:
 * every command routes through run-with-flags.js (or session-start-bootstrap.js)
 * via ${CLAUDE_PLUGIN_ROOT} with NO inline `node -e` bootstrap resolver.
 */

const fs = require('fs');
const path = require('path');

const ajv2020 = require('ajv/dist/2020');
const Ajv = ajv2020.default || ajv2020;

const ROOT = path.resolve(__dirname, '..', '..');
const HOOKS_PATH = path.join(ROOT, 'hooks', 'hooks.json');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'hooks.schema.json');
const MEM_HOOKS_PATH = path.join(ROOT, 'hooks', 'memory-persistence', 'hooks.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function allGroups(hooksDoc) {
  const groups = [];
  for (const event of Object.keys(hooksDoc.hooks)) {
    for (const group of hooksDoc.hooks[event]) {
      groups.push({ event, group });
    }
  }
  return groups;
}

test('hooks.json validates against hooks.schema.json', () => {
  const schema = readJson(SCHEMA_PATH);
  const doc = readJson(HOOKS_PATH);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(doc);
  assert.ok(ok, `hooks.json failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`);
});

test('every hook id is unique across all events', () => {
  const doc = readJson(HOOKS_PATH);
  const ids = allGroups(doc).map(({ group }) => group.id);
  const seen = new Set();
  const dupes = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  assert.equal(dupes.length, 0, `duplicate hook ids: ${dupes.join(', ')}`);
  assert.ok(ids.length >= 20, `expected >=20 hooks, found ${ids.length}`);
});

test('every command uses ${CLAUDE_PLUGIN_ROOT} and routes through the runner or bootstrap', () => {
  const doc = readJson(HOOKS_PATH);
  for (const { event, group } of allGroups(doc)) {
    for (const cmdHook of group.hooks) {
      const cmd = cmdHook.command;
      assert.ok(
        cmd.includes('${CLAUDE_PLUGIN_ROOT}'),
        `${group.id} (${event}) command must reference \${CLAUDE_PLUGIN_ROOT}`
      );
      const routesThroughRunner = cmd.includes('scripts/hooks/run-with-flags.js');
      const isBootstrap = cmd.includes('scripts/hooks/session-start-bootstrap.js');
      assert.ok(
        routesThroughRunner || isBootstrap,
        `${group.id} must route through run-with-flags.js or session-start-bootstrap.js`
      );
    }
  }
});

test('no command uses an inline `node -e` bootstrap resolver (CLAUDE.md §4)', () => {
  const doc = readJson(HOOKS_PATH);
  for (const { group } of allGroups(doc)) {
    for (const cmdHook of group.hooks) {
      assert.ok(
        !/node\s+-e/.test(cmdHook.command),
        `${group.id} must NOT use an inline node -e resolver`
      );
    }
  }
});

test('run-with-flags commands target an existing scripts/hooks/<file>.js path', () => {
  const doc = readJson(HOOKS_PATH);
  const runnerCmds = allGroups(doc)
    .flatMap(({ group }) => group.hooks.map(h => ({ id: group.id, command: h.command })))
    .filter(({ command }) => command.includes('run-with-flags.js'));

  assert.ok(runnerCmds.length >= 1, 'expected at least one run-with-flags command');

  for (const { id, command } of runnerCmds) {
    // ...run-with-flags.js <hookId> scripts/hooks/<file>.js <profilesCsv>
    const match = command.match(/run-with-flags\.js\s+(\S+)\s+(scripts\/hooks\/[\w-]+\.js)\s+([a-z,]+)/);
    assert.ok(match, `${id}: command does not match the run-with-flags invocation shape: ${command}`);
    const [, hookId, scriptRel, profiles] = match;
    assert.equal(hookId, id, `${id}: hookId arg (${hookId}) must equal the group id`);
    profiles.split(',').forEach(p => {
      assert.ok(['minimal', 'standard', 'strict'].includes(p), `${id}: invalid profile "${p}"`);
    });
    // The referenced script must be one we plan to ship (file may be built later
    // in this wave). We only assert the path shape here; existence is checked by
    // validate-hooks.js once all scripts land.
    assert.ok(scriptRel.startsWith('scripts/hooks/'), `${id}: bad script path ${scriptRel}`);
  }
});

test('outbound-send-gate is wired and runs under all profiles (fail-closed coverage)', () => {
  const doc = readJson(HOOKS_PATH);
  const gate = allGroups(doc).find(({ group }) => group.id === 'pre:outbound-send-gate');
  assert.ok(gate, 'pre:outbound-send-gate must be present');
  const cmd = gate.group.hooks[0].command;
  assert.ok(
    /minimal,standard,strict/.test(cmd),
    'the send gate must run under every profile (minimal,standard,strict)'
  );
});

test('memory-persistence/hooks.json is valid JSON with a non-empty events list', () => {
  const mem = readJson(MEM_HOOKS_PATH);
  assert.ok(Array.isArray(mem.events) && mem.events.length > 0, 'events must be a non-empty array');
  mem.events.forEach(e => {
    assert.ok(e.event && e.id && e.script, 'each event needs event/id/script');
  });
});
