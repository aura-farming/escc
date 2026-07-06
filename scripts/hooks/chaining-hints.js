#!/usr/bin/env node
/*
 * ESCC post:chaining-hints — next-play suggestion after a high-signal tool
 * result (NEW for ESCC; ADR-0016).
 *
 * The agentic-feel layer: when a tool result creates an obvious next sales
 * motion (a Fireflies transcript lands -> discovery-notes; a Gmail thread is
 * read -> reply-handling; HubSpot deal data is pulled -> deal-review), inject
 * ONE one-line hint naming the chained skill. Chains live in
 * config/tool-skill-chains.json.
 *
 * Noise control, by construction: each chain FAMILY fires at most once per
 * session — a worklist doing 40 HubSpot reads gets one hint, not 40. The
 * dedupe marker lives in a per-session temp file (the metrics-bridge pattern),
 * so it needs no state-store and cleans up with the OS temp dir.
 *
 * Failure policy: PURE HINT — never blocks, never rewrites the tool result.
 * Skips errored tool calls. Fails OPEN (exit 0) on any internal error.
 */
/**
 * post:chaining-hints
 *   matcher: Fireflies get_* | Gmail get_thread/search_threads | HubSpot CRM reads
 *   profiles: standard, strict
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseHookInput, getToolName, getToolInput, getSessionId } = require('../lib/hook-input');

const CONFIG_RELATIVE = path.join('config', 'tool-skill-chains.json');
const MAX_INPUT_SCAN_CHARS = 4000;

let cachedChains = null;

/** Load + compile the chain table once per process. Fails open to []. */
function loadChains(pluginRoot) {
  if (cachedChains) return cachedChains;
  try {
    const root = pluginRoot || path.resolve(__dirname, '..', '..');
    const parsed = JSON.parse(fs.readFileSync(path.join(root, CONFIG_RELATIVE), 'utf8'));
    const chains = Array.isArray(parsed.chains) ? parsed.chains : [];
    cachedChains = chains
      .map((c) => {
        let regex = null;
        try {
          regex = new RegExp(`^(?:${c.match})$`, 'i');
        } catch (_err) {
          /* invalid pattern -> chain skipped */
        }
        return {
          family: c.family || '',
          regex,
          inputMatch: typeof c.input_match === 'string' ? c.input_match.toLowerCase() : '',
          skill: c.skill || '',
          hint: c.hint || '',
        };
      })
      .filter((c) => c.family && c.regex && c.skill && c.hint);
  } catch (_err) {
    cachedChains = [];
  }
  return cachedChains;
}

/** Per-session dedupe file (metrics-bridge pattern: tmpdir + sanitized id). */
function stateFile(sessionId) {
  const stem = String(sessionId || 'default').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 64) || 'default';
  return path.join(os.tmpdir(), `escc-chain-hints-${stem}.json`);
}

function readFired(sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
    return Array.isArray(parsed.fired) ? parsed.fired : [];
  } catch (_err) {
    return [];
  }
}

function markFired(sessionId, family) {
  try {
    const fired = readFired(sessionId);
    if (!fired.includes(family)) fired.push(family);
    fs.writeFileSync(stateFile(sessionId), JSON.stringify({ fired }));
  } catch (_err) {
    /* dedupe is best-effort — a lost marker means at worst one extra hint */
  }
}

/** Did the tool call error? (Field names vary; absence means success.) */
function toolErrored(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.tool_error === true || input.is_error === true) return true;
  const resp = input.tool_response;
  if (resp && typeof resp === 'object' && resp.is_error === true) return true;
  return false;
}

/** Find the chain for this tool call, honoring the optional input filter. */
function matchChain(toolName, toolInput, chains) {
  const name = String(toolName || '');
  if (!name) return null;
  for (const chain of chains) {
    if (!chain.regex.test(name)) continue;
    if (chain.inputMatch) {
      let haystack = '';
      try {
        haystack = JSON.stringify(toolInput || {}).toLowerCase().slice(0, MAX_INPUT_SCAN_CHARS);
      } catch (_err) {
        haystack = '';
      }
      if (!haystack.includes(chain.inputMatch)) continue;
    }
    return chain;
  }
  return null;
}

/**
 * @param {string|object} raw PostToolUse event JSON
 * @param {{pluginRoot?: boolean, truncated?: boolean}} [ctx]
 * @returns {{additionalContext:string}|{exitCode:number}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    const input = parseHookInput(raw);
    if (toolErrored(input)) return undefined; // no next-play hint off a failed call
    const toolName = getToolName(input);
    // A truncated payload keeps the tool name but the input can't be trusted
    // for the input_match filter — only match filter-less chains then.
    const toolInput = ctx && ctx.truncated ? {} : getToolInput(input);
    const chain = matchChain(toolName, toolInput, loadChains(ctx.pluginRoot));
    if (!chain) return undefined;

    const sessionId = getSessionId(input);
    if (readFired(sessionId).includes(chain.family)) return undefined; // once per family per session
    markFired(sessionId, chain.family);

    return { additionalContext: `🔗 escc next-step: ${chain.hint}` };
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — a hint must never block a tool result
  }
}

module.exports = { run, loadChains, matchChain, toolErrored, stateFile, readFired, markFired };

if (require.main === module) {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_err) {
    raw = '';
  }
  let result;
  try {
    result = run(raw, {});
  } catch (_err) {
    result = { exitCode: 0 };
  }
  if (result && result.additionalContext) process.stderr.write(`${result.additionalContext}\n`);
  process.stdout.write(raw);
  process.exit(0);
}
