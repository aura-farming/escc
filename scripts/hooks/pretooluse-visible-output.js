#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/pretooluse-visible-output.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Ported into the ESCC namespace, then generalized: the additionalContext
 * builder stamps the actual firing event (PreToolUse/PostToolUse/
 * UserPromptSubmit/SessionStart), not a hardcoded PreToolUse.
 */
/**
 * Helpers for emitting PreToolUse `additionalContext` — the only hook output
 * the harness surfaces back into the model's context. A hook returns
 * { additionalContext } and the dispatch runner serializes it through here.
 */

'use strict';

function normalizeAdditionalContext(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  return String(value || '').trim();
}

function combineAdditionalContext(current, next) {
  const currentText = normalizeAdditionalContext(current);
  const nextText = normalizeAdditionalContext(next);

  if (!currentText) return nextText;
  if (!nextText) return currentText;

  return `${currentText}\n${nextText}`;
}

function buildAdditionalContext(value, eventName) {
  const additionalContext = normalizeAdditionalContext(value);
  if (!additionalContext) return '';

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName || 'PreToolUse',
      additionalContext,
    },
  });
}

// Back-compat alias for the PreToolUse call site.
function buildPreToolUseAdditionalContext(value) {
  return buildAdditionalContext(value, 'PreToolUse');
}

module.exports = {
  buildAdditionalContext,
  buildPreToolUseAdditionalContext,
  combineAdditionalContext,
  normalizeAdditionalContext,
};
