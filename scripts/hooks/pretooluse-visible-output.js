#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/pretooluse-visible-output.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Unchanged in behavior; ported verbatim into the ESCC namespace.
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

function buildPreToolUseAdditionalContext(value) {
  const additionalContext = normalizeAdditionalContext(value);
  if (!additionalContext) return '';

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext,
    },
  });
}

module.exports = {
  buildPreToolUseAdditionalContext,
  combineAdditionalContext,
  normalizeAdditionalContext,
};
