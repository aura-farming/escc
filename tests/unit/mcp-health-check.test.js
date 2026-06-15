'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/mcp-health-check');

// Hermetic temp paths for state + config; isolate every assertion from real
// ~/.claude files and from prior runs.
function tmpFile(name) {
  return path.join(os.tmpdir(), `escc-mcphc-test-${process.pid}-${Math.random().toString(36).slice(2)}-${name}`);
}

function preToolInput(toolName, extra = {}) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: {},
    ...extra,
  });
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj), 'utf8');
}

function clearEnv() {
  delete process.env.ESCC_MCP_HEALTH_FAIL_OPEN;
  delete process.env.ESCC_MCP_HEALTH_STATE_PATH;
  delete process.env.ESCC_MCP_CONFIG_PATH;
  delete process.env.ESCC_MCP_RECONNECT_COMMAND;
}

test('extractMcpTarget parses mcp__server__tool names', () => {
  const t = hook.extractMcpTarget({ tool_name: 'mcp__hubspot__search_crm_objects' });
  assert.ok(t);
  assert.equal(t.server, 'hubspot');
  assert.equal(t.tool, 'search_crm_objects');
});

test('extractMcpTarget returns null for non-mcp tools', () => {
  assert.equal(hook.extractMcpTarget({ tool_name: 'Bash' }), null);
  assert.equal(hook.extractMcpTarget({ tool_name: '' }), null);
});

test('run passes through (undefined) for a non-MCP tool call', () => {
  clearEnv();
  const result = hook.run(preToolInput('Read'));
  assert.equal(result, undefined);
});

test('run passes (exit 0) when server is cached healthy and fresh', () => {
  clearEnv();
  const statePath = tmpFile('state.json');
  process.env.ESCC_MCP_HEALTH_STATE_PATH = statePath;
  const now = Date.now();
  writeJson(statePath, { version: 1, servers: { hubspot: { status: 'healthy', expiresAt: now + 60000 } } });

  const result = hook.run(preToolInput('mcp__hubspot__search_crm_objects'));
  assert.ok(result && result.exitCode === 0);
  fs.rmSync(statePath, { force: true });
  clearEnv();
});

test('run BLOCKS (exit 2) when server is cached unhealthy within backoff window', () => {
  clearEnv();
  const statePath = tmpFile('state.json');
  process.env.ESCC_MCP_HEALTH_STATE_PATH = statePath;
  const now = Date.now();
  writeJson(statePath, { version: 1, servers: { hubspot: { status: 'unhealthy', nextRetryAt: now + 60000 } } });

  const result = hook.run(preToolInput('mcp__hubspot__manage_crm_objects'));
  assert.ok(result && result.exitCode === 2);
  assert.match(result.stderr, /unhealthy/i);
  fs.rmSync(statePath, { force: true });
  clearEnv();
});

test('run fails OPEN (exit 0) when ESCC_MCP_HEALTH_FAIL_OPEN is set, even for an unhealthy server', () => {
  clearEnv();
  const statePath = tmpFile('state.json');
  process.env.ESCC_MCP_HEALTH_STATE_PATH = statePath;
  process.env.ESCC_MCP_HEALTH_FAIL_OPEN = '1';
  const now = Date.now();
  writeJson(statePath, { version: 1, servers: { hubspot: { status: 'unhealthy', nextRetryAt: now + 60000 } } });

  const result = hook.run(preToolInput('mcp__hubspot__manage_crm_objects'));
  assert.ok(result && result.exitCode === 0);
  fs.rmSync(statePath, { force: true });
  clearEnv();
});

test('run fails OPEN (exit 0) when no MCP config is found for the server', () => {
  clearEnv();
  const statePath = tmpFile('state.json');
  const configPath = tmpFile('config.json');
  process.env.ESCC_MCP_HEALTH_STATE_PATH = statePath;
  process.env.ESCC_MCP_CONFIG_PATH = configPath;
  writeJson(configPath, { mcpServers: {} });

  const result = hook.run(preToolInput('mcp__unknownserver__do_thing'));
  assert.ok(result && result.exitCode === 0);
  fs.rmSync(statePath, { force: true });
  fs.rmSync(configPath, { force: true });
  clearEnv();
});

test('run treats an HTTP/url server as reachable on the live probe (exit 0)', () => {
  clearEnv();
  const statePath = tmpFile('state.json');
  const configPath = tmpFile('config.json');
  process.env.ESCC_MCP_HEALTH_STATE_PATH = statePath;
  process.env.ESCC_MCP_CONFIG_PATH = configPath;
  writeJson(configPath, { mcpServers: { hubspot: { type: 'http', url: 'https://example.invalid/mcp' } } });

  const result = hook.run(preToolInput('mcp__hubspot__search_crm_objects'));
  assert.ok(result && result.exitCode === 0);
  // state should now be marked healthy
  const state = hook.loadState(statePath);
  assert.equal(state.servers.hubspot.status, 'healthy');
  fs.rmSync(statePath, { force: true });
  fs.rmSync(configPath, { force: true });
  clearEnv();
});

test('run BLOCKS (exit 2) when a command server probe fails (bad command exits immediately)', () => {
  clearEnv();
  const statePath = tmpFile('state.json');
  const configPath = tmpFile('config.json');
  process.env.ESCC_MCP_HEALTH_STATE_PATH = statePath;
  process.env.ESCC_MCP_CONFIG_PATH = configPath;
  // `false` exits 1 immediately -> probe sees an early exit -> unhealthy.
  writeJson(configPath, { mcpServers: { localmcp: { command: 'false', args: [] } } });

  const result = hook.run(preToolInput('mcp__localmcp__do_thing'));
  assert.ok(result && result.exitCode === 2);
  const state = hook.loadState(statePath);
  assert.equal(state.servers.localmcp.status, 'unhealthy');
  fs.rmSync(statePath, { force: true });
  fs.rmSync(configPath, { force: true });
  clearEnv();
});

test('run BLOCKS (exit 2) on a truncated payload that still yields a target', () => {
  clearEnv();
  const statePath = tmpFile('state.json');
  process.env.ESCC_MCP_HEALTH_STATE_PATH = statePath;
  const result = hook.run(preToolInput('mcp__hubspot__search_crm_objects'), { truncated: true });
  assert.ok(result && result.exitCode === 2);
  assert.match(result.stderr, /truncated/i);
  clearEnv();
});

test('run never throws on garbage input (fails open)', () => {
  clearEnv();
  const result = hook.run('not json at all {', {});
  // garbage -> no target -> undefined (no opinion)
  assert.equal(result, undefined);
});
