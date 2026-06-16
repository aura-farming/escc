/*
 * ESCC instinct OBSERVE logic (NEW for ESCC; concept adapted from ECC
 * continuous-learning-v2's observe.sh, which was bash — ESCC does a Node rewrite,
 * deps = ajv only).
 *
 * Pure, side-effect-free helpers that turn a raw PreToolUse/PostToolUse hook
 * payload into a single observation row. The observe-runner hook persists what
 * these return; distill consumes it.
 *
 * I3 (untrusted-content guard, capture side): tools whose OUTPUT injects
 * external / prospect-authored content (web pages, prospect email threads, call
 * transcripts, scraped/search results) are tagged untrusted:true. The distill
 * step refuses to derive an instinct from any untrusted observation, so a
 * prompt-injection buried in a prospect email can never become a learned
 * behavior. We tag by tool identity, NOT by inspecting output — observe-runner
 * never stores tool OUTPUT content at all.
 */

'use strict';

const { parseHookInput, getToolName, getSessionId, getEventName } = require('../lib/hook-input');

/**
 * Tools whose RESULT carries content authored outside the rep's own system.
 * Conservative by design: over-tagging an external read as untrusted only costs
 * us a low-signal learning opportunity, whereas under-tagging risks learning
 * from injected content. The rep's own actions (Edit/Write/Bash/CRM writes,
 * composing a draft) are deliberately NOT here — they are the legitimate source
 * of instincts (user-initiated tool sequences, error resolutions).
 */
// MCP tools are named mcp__<server>__<tool>, where the server segment may itself
// contain underscores and ends with the service word (e.g. claude_ai_Gmail,
// plugin_ecc_chrome-devtools). So we match `<service>__<tool>` at the tool
// boundary, NOT a leading `__<service>__`.
const UNTRUSTED_TOOL_PATTERNS = [
  /^WebFetch$/i,
  /^WebSearch$/i,
  /Gmail__(get|search|list)/i, // reading prospect threads / drafts
  /Fireflies__/i, // call transcripts = prospect speech
  /firecrawl__/i, // scraped web content
  /exa__/i, // web search results
  /Intercom__/i, // customer-authored messages
  /chrome-devtools__(take_snapshot|take_screenshot|get_console_message|list_console_messages|get_network_request|list_network_requests|evaluate_script)/i,
];

/**
 * Is this tool one whose output carries untrusted external content?
 * @param {string} toolName
 * @returns {boolean}
 */
function isUntrustedTool(toolName) {
  const name = String(toolName || '');
  if (!name) return false;
  return UNTRUSTED_TOOL_PATTERNS.some(re => re.test(name));
}

/** Did a PostToolUse result indicate an error? Defensive across response shapes. */
function toolErrored(input) {
  const resp = input && input.tool_response;
  if (resp && typeof resp === 'object') {
    if (resp.is_error === true || resp.error) return true;
    if (typeof resp.status === 'string' && /error|fail/i.test(resp.status)) return true;
  }
  if (input && input.error) return true;
  return false;
}

/** Map a hook event name / explicit override to the compact 'pre'|'post' tag. */
function resolveEvent(input, opts = {}) {
  if (opts.event === 'pre' || opts.event === 'post') return opts.event;
  const name = getEventName(input);
  if (name === 'PostToolUse') return 'post';
  if (name === 'PreToolUse') return 'pre';
  return 'pre';
}

/**
 * Build the observation row for a tool-use hook event. Returns null when there
 * is no tool to record (lifecycle events, junk payloads) so the caller records
 * nothing. NEVER includes tool OUTPUT content (I3).
 *
 * @param {string|object} rawOrInput raw hook stdin (or already-parsed object)
 * @param {{event?: 'pre'|'post'}} [opts]
 * @returns {object|null}
 */
function buildObservation(rawOrInput, opts = {}) {
  const input = parseHookInput(rawOrInput);
  const tool = getToolName(input);
  if (!tool) return null;

  const event = resolveEvent(input, opts);
  const obs = {
    kind: 'tool_use',
    event,
    tool,
    session_id: getSessionId(input) || null,
    untrusted: isUntrustedTool(tool),
  };
  // Only a completed call can be known to have errored; pre has no result yet.
  if (event === 'post') obs.error = toolErrored(input);
  return obs;
}

module.exports = {
  UNTRUSTED_TOOL_PATTERNS,
  isUntrustedTool,
  toolErrored,
  resolveEvent,
  buildObservation,
};
