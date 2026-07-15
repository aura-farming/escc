#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/mcp-health-check.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*; ported the health-state decision + command-server
 * probe synchronously so it runs inside the ESCC dispatcher's sync run() contract.
 */
/**
 * pre:mcp-health-check — probe MCP server health before an mcp__* tool call.
 *
 * For a sales harness the live MCP servers are CRM/research/email connectors
 * (HubSpot, web research, Gmail-draft). When one of those is down, this hook
 * stops Claude from hammering a dead connector and lets it fall back to a
 * non-MCP path. Health state is persisted outside the conversation context so
 * it survives compaction and later turns.
 *
 * Failure policy: fails OPEN on internal error, missing state/config, a
 * truncated payload, or when ESCC_MCP_HEALTH_FAIL_OPEN is set (return exit 0).
 * It MAY return exit 2 to BLOCK an mcp call to a server currently marked
 * unhealthy (within its backoff window) or one that fails a live probe — that
 * is the hook's purpose.
 *
 * run() is synchronous (the dispatcher does not await it):
 *  - The block-from-cached-state decision (the security-relevant part) is fully
 *    synchronous.
 *  - Command (stdio) servers are probed synchronously via spawnSync: the probe
 *    writes one newline-delimited JSON-RPC `initialize` request and treats an
 *    answer on stdout as healthy. Spec-compliant stdio servers exit cleanly on
 *    stdin EOF, so "it responded" — not "it outlived the timeout" — is the
 *    primary health signal (and a healthy probe returns in milliseconds instead
 *    of burning the full timeout).
 *  - HTTP/SSE servers cannot be probed without an async client, so they are
 *    treated as reachable on the live-probe path; their cached-unhealthy state
 *    is still honored. See the note in probeServerSync().
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseHookInput, getToolName, getToolInput } = require('../lib/hook-input');

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
const RECONNECT_STATUS_CODES = new Set([401, 403, 429, 503]);

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function shouldFailOpen() {
  return /^(1|true|yes)$/i.test(String(process.env.ESCC_MCP_HEALTH_FAIL_OPEN || ''));
}

function stateFilePath() {
  if (process.env.ESCC_MCP_HEALTH_STATE_PATH) {
    return path.resolve(process.env.ESCC_MCP_HEALTH_STATE_PATH);
  }
  return path.join(os.homedir(), '.claude', 'mcp-health-cache.json');
}

function configPaths() {
  if (process.env.ESCC_MCP_CONFIG_PATH) {
    return process.env.ESCC_MCP_CONFIG_PATH
      .split(path.delimiter)
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => path.resolve(entry));
  }

  const cwd = process.cwd();
  const home = os.homedir();

  return [
    path.join(cwd, '.claude.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(home, '.claude.json'),
    path.join(home, '.claude', 'settings.json'),
  ];
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadState(filePath) {
  const state = readJsonFile(filePath);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { version: 1, servers: {} };
  }
  if (!state.servers || typeof state.servers !== 'object' || Array.isArray(state.servers)) {
    state.servers = {};
  }
  return state;
}

function saveState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch {
    // Never block the hook on state persistence errors.
  }
}

/**
 * Identify which MCP server/tool the call targets. Mirrors the ECC extractor:
 * an explicit server field wins; otherwise the mcp__<server>__<tool> name is
 * parsed.
 * @param {object} input parsed hook event
 * @returns {{server:string, tool:string}|null}
 */
function extractMcpTarget(input) {
  const toolName = getToolName(input) || String(input.name || '');
  const toolInput = getToolInput(input);
  const explicitServer = input.server
    || input.mcp_server
    || toolInput.server
    || toolInput.mcp_server
    || toolInput.connector
    || null;
  const explicitTool = input.tool
    || input.mcp_tool
    || toolInput.tool
    || toolInput.mcp_tool
    || null;

  if (explicitServer) {
    return { server: String(explicitServer), tool: explicitTool ? String(explicitTool) : toolName };
  }

  if (!toolName.startsWith('mcp__')) return null;

  const segments = toolName.slice(5).split('__');
  if (segments.length < 2 || !segments[0]) return null;

  return { server: segments[0], tool: segments.slice(1).join('__') };
}

function resolveServerConfig(serverName) {
  for (const filePath of configPaths()) {
    const data = readJsonFile(filePath);
    const server = (data && data.mcpServers && data.mcpServers[serverName])
      || (data && data.mcp_servers && data.mcp_servers[serverName])
      || null;
    if (server && typeof server === 'object' && !Array.isArray(server)) {
      return { config: server, source: filePath };
    }
  }
  return null;
}

function markHealthy(state, serverName, now, details = {}) {
  state.servers[serverName] = {
    status: 'healthy',
    checkedAt: now,
    expiresAt: now + envNumber('ESCC_MCP_HEALTH_TTL_MS', DEFAULT_TTL_MS),
    failureCount: 0,
    lastError: null,
    lastFailureCode: null,
    nextRetryAt: now,
    lastRestoredAt: now,
    ...details,
  };
}

function markUnhealthy(state, serverName, now, failureCode, errorMessage) {
  const previous = state.servers[serverName] || {};
  const failureCount = Number(previous.failureCount || 0) + 1;
  const backoffBase = envNumber('ESCC_MCP_HEALTH_BACKOFF_MS', DEFAULT_BACKOFF_MS);
  const nextRetryDelay = Math.min(backoffBase * (2 ** Math.max(failureCount - 1, 0)), MAX_BACKOFF_MS);

  state.servers[serverName] = {
    status: 'unhealthy',
    checkedAt: now,
    expiresAt: now,
    failureCount,
    lastError: errorMessage || null,
    lastFailureCode: failureCode || null,
    nextRetryAt: now + nextRetryDelay,
    lastRestoredAt: previous.lastRestoredAt || null,
  };
}

/**
 * Synchronous probe.
 *
 * Command (stdio) servers: spawnSync the configured command with a timeout. If
 * the process accepts the spawn and stays alive until the timeout (no crash),
 * the endpoint is reachable — same heuristic ECC used for stdio handshakes. A
 * non-zero/early exit with stderr is a failure.
 *
 * HTTP/SSE servers: a faithful reachability probe needs an async HTTP client,
 * which run() cannot await. We therefore treat HTTP servers as reachable on the
 * live-probe path (the authenticated MCP client will surface real auth/transport
 * errors on PostToolUseFailure in ECC). Their cached-unhealthy state is still
 * honored above, so a server already known-bad stays blocked within its backoff.
 *
 * @returns {{ok:boolean, failureCode:(number|null), reason:string}}
 */
function probeServerSync(serverName, resolvedConfig) {
  const config = resolvedConfig.config;
  const timeoutMs = envNumber('ESCC_MCP_HEALTH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);

  if (config.type === 'http' || config.url) {
    // Cannot sync-probe HTTP without blocking the loop; treat as reachable.
    return { ok: true, failureCode: null, reason: 'http endpoint not sync-probed; treated as reachable' };
  }

  if (config.command && typeof config.command === 'string') {
    const args = Array.isArray(config.args) ? config.args.map(a => String(a)) : [];
    const mergedEnv = {
      ...process.env,
      ...(config.env && typeof config.env === 'object' && !Array.isArray(config.env) ? config.env : {}),
    };
    // One newline-delimited JSON-RPC initialize per the MCP stdio transport.
    // spawnSync writes it and then closes stdin — a spec-compliant server
    // answers on stdout and exits cleanly on the EOF, so an answer (not
    // survival past the timeout) is the primary health signal.
    const initialize = `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'escc-mcp-health-probe', version: '1.0.0' },
      },
    })}\n`;
    let result;
    try {
      result = spawnSync(config.command, args, {
        env: mergedEnv,
        cwd: process.cwd(),
        input: initialize,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        encoding: 'utf8',
      });
    } catch (err) {
      return { ok: false, failureCode: null, reason: err.message };
    }

    // Best signal first: the server answered JSON-RPC on stdout. Healthy no
    // matter how it exited — SDK-built stdio servers exit(0) on stdin EOF, and
    // before v1.10.0 that clean fast exit was misread as a failed probe.
    if (/"jsonrpc"/.test(String(result.stdout || ''))) {
      return { ok: true, failureCode: null, reason: `${serverName} answered the initialize probe` };
    }
    // Killed by the timeout -> the server kept running past the spawn, i.e. it
    // accepted a new stdio process (reachable, just quiet toward our probe).
    if (result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT') {
      return { ok: true, failureCode: null, reason: `${serverName} accepted a new stdio process` };
    }
    if (result.error) {
      return { ok: false, failureCode: null, reason: result.error.message };
    }
    // Exited before the timeout without answering: crashed, or not an MCP server.
    const stderr = String(result.stderr || '').trim();
    return {
      ok: false,
      failureCode: null,
      reason: stderr || `process exited without answering the initialize probe (${result.status})`,
    };
  }

  return { ok: false, failureCode: null, reason: 'unsupported MCP server config' };
}

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean}} [ctx]
 * @returns {{exitCode:number, stderr?:string}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    if (shouldFailOpen()) return { exitCode: 0 };

    const input = parseHookInput(raw);
    const target = extractMcpTarget(input);
    if (!target) return undefined; // not an MCP call; no opinion

    if (ctx && ctx.truncated) {
      // Cannot reliably parse the target from a truncated payload — but if we
      // got one anyway, refuse to bypass the check: block (fail-open is handled
      // above). Without a target we already returned undefined.
      return {
        exitCode: 2,
        stderr: `[mcp-health-check] BLOCKED: hook input truncated; cannot verify ${target.server} health. Retry or set ESCC_MCP_HEALTH_FAIL_OPEN=1.`,
      };
    }

    const now = Date.now();
    const statePathValue = stateFilePath();
    const state = loadState(statePathValue);
    const previous = state.servers[target.server] || {};

    // Cached healthy and still fresh -> pass without re-probing.
    if (previous.status === 'healthy' && Number(previous.expiresAt || 0) > now) {
      return { exitCode: 0 };
    }

    // Cached unhealthy and still inside its backoff window -> block.
    if (previous.status === 'unhealthy' && Number(previous.nextRetryAt || 0) > now) {
      return {
        exitCode: 2,
        stderr: `[mcp-health-check] ${target.server} is marked unhealthy until ${new Date(previous.nextRetryAt).toISOString()}; blocking ${target.tool || 'tool'} so Claude can fall back to non-MCP tools.`,
      };
    }

    const resolvedConfig = resolveServerConfig(target.server);
    if (!resolvedConfig) {
      // No config to probe -> fail open (cannot prove it is down).
      return { exitCode: 0 };
    }

    const probe = probeServerSync(target.server, resolvedConfig);
    if (probe.ok) {
      markHealthy(state, target.server, now, { source: resolvedConfig.source });
      saveState(statePathValue, state);
      return { exitCode: 0 };
    }

    markUnhealthy(state, target.server, now, probe.failureCode, probe.reason);
    saveState(statePathValue, state);

    return {
      exitCode: 2,
      stderr: `[mcp-health-check] ${target.server} is unavailable (${probe.reason}). Blocking ${target.tool || 'tool'} so Claude can fall back to non-MCP tools.`,
    };
  } catch (_err) {
    return { exitCode: 0 }; // fail open on internal error
  }
}

module.exports = {
  run,
  extractMcpTarget,
  resolveServerConfig,
  loadState,
  markHealthy,
  markUnhealthy,
  shouldFailOpen,
  RECONNECT_STATUS_CODES,
};

if (require.main === module) {
  const stdinFs = require('fs');
  let raw = '';
  try { raw = stdinFs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try { result = run(raw, { truncated }); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  if (result && result.exitCode === 2) process.exit(2);
  process.stdout.write(raw);
  process.exit(0);
}
