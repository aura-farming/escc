/*
 * ESCC hook-input helpers (NEW for ESCC).
 *
 * Every hook receives the raw PreToolUse/PostToolUse/lifecycle JSON event that
 * Claude Code writes to stdin. These helpers parse it defensively — a malformed
 * or truncated payload yields {} / '' rather than throwing, so a fail-open hook
 * stays fail-open and a fail-closed hook can make its own decision from the
 * empty result.
 */

'use strict';

/**
 * Parse a hook stdin payload into an object. Accepts either the raw string or
 * an already-parsed object. Never throws; returns {} on any parse failure.
 * @param {string|object} inputOrRaw
 * @returns {object}
 */
function parseHookInput(inputOrRaw) {
  if (inputOrRaw && typeof inputOrRaw === 'object') {
    return inputOrRaw;
  }
  if (typeof inputOrRaw === 'string') {
    const trimmed = inputOrRaw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_err) {
      return {};
    }
  }
  return {};
}

/** @param {object} input @returns {string} */
function getToolName(input) {
  return (input && typeof input.tool_name === 'string') ? input.tool_name : '';
}

/** @param {object} input @returns {object} */
function getToolInput(input) {
  return (input && input.tool_input && typeof input.tool_input === 'object') ? input.tool_input : {};
}

/** @param {object} input @returns {string} */
function getSessionId(input) {
  return (input && typeof input.session_id === 'string') ? input.session_id : '';
}

/**
 * Resolve the file path an Edit/Write/Read tool targets, across the field-name
 * variants Claude Code tools use (file_path, path, file).
 * @param {object} toolInput
 * @returns {string}
 */
function getFilePath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  return toolInput.file_path || toolInput.path || toolInput.file || '';
}

/** @param {object} input @returns {string} the hook event name, if present */
function getEventName(input) {
  return (input && typeof input.hook_event_name === 'string') ? input.hook_event_name : '';
}

module.exports = {
  parseHookInput,
  getToolName,
  getToolInput,
  getSessionId,
  getFilePath,
  getEventName,
};
