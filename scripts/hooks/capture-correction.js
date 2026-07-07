#!/usr/bin/env node
/*
 * ESCC prompt:capture-correction — learn from REP JUDGMENT, not just tool
 * mechanics (NEW for ESCC; v1.8.0 learning loop).
 *
 * The instinct engine's strongest signal — kind 'user_correction'
 * (distill THRESHOLDS.user_correction = 1) — had NO writer: reps re-taught
 * the system every session. This UserPromptSubmit hook detects an explicit
 * correction in the rep's own prompt (config/correction-patterns.json,
 * conservative by design) and appends a user_correction observation. Nothing
 * auto-applies: the drafted instinct still passes the I7 human review gate
 * (/instinct-status) before it ever influences behavior.
 *
 * Trust note (I3): a prompt is the REP's own trusted channel — but a very
 * long prompt is likely pasted third-party content, so it is skipped, and
 * only a bounded slice of the text is stored.
 *
 * Failure policy: PURE OBSERVER — silent (no context injected), never blocks,
 * fails OPEN on any internal error.
 */
/**
 * prompt:capture-correction
 *   matcher: * (UserPromptSubmit)
 *   profiles: standard, strict
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseHookInput } = require('../lib/hook-input');
const instinctStore = require('../instincts/instinct-store');

const CONFIG_RELATIVE = path.join('config', 'correction-patterns.json');
const TEXT_CAP = 300;

let cachedConfig = null;
let cachedRoot = null;

function loadConfig(pluginRoot) {
  const root = pluginRoot || path.resolve(__dirname, '..', '..');
  if (cachedConfig && cachedRoot === root) return cachedConfig;
  cachedRoot = root;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, CONFIG_RELATIVE), 'utf8'));
    const regexes = [];
    for (const p of Array.isArray(parsed.patterns) ? parsed.patterns : []) {
      try {
        regexes.push(new RegExp(p, 'i'));
      } catch (_err) {
        /* skip invalid pattern */
      }
    }
    cachedConfig = {
      minChars: Number.isInteger(parsed.min_chars) ? parsed.min_chars : 12,
      maxChars: Number.isInteger(parsed.max_chars) ? parsed.max_chars : 600,
      regexes,
    };
  } catch (_err) {
    cachedConfig = { minChars: 12, maxChars: 600, regexes: [] };
  }
  return cachedConfig;
}

function getPromptText(input) {
  for (const key of ['prompt', 'user_input', 'user_message']) {
    if (input && typeof input[key] === 'string' && input[key].trim()) return input[key];
  }
  return '';
}

/** Is this prompt an explicit rep correction worth learning? */
function isCorrection(prompt, config) {
  const trimmed = String(prompt || '').trim();
  if (trimmed.length < config.minChars || trimmed.length > config.maxChars) return false;
  if (trimmed.startsWith('/')) return false; // a command, not a correction
  return config.regexes.some(re => re.test(trimmed));
}

/**
 * @param {string|object} raw UserPromptSubmit event JSON
 * @param {{pluginRoot?: string}} [ctx]
 * @returns {{exitCode:number}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const prompt = getPromptText(input);
    const config = loadConfig(ctx.pluginRoot);
    if (!isCorrection(prompt, config)) return undefined;
    instinctStore.appendObservation({
      kind: 'user_correction',
      event: 'prompt',
      session_id: input.session_id || input.sessionId || null,
      text: String(prompt).trim().slice(0, TEXT_CAP),
      untrusted: false, // the rep's own prompt is the trusted channel (I3)
    });
    return undefined; // silent — zero noise in the conversation
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — capture must never block a prompt
  }
}

module.exports = { run, isCorrection, loadConfig, getPromptText };

if (require.main === module) {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_err) {
    raw = '';
  }
  try {
    run(raw, {});
  } catch (_err) {
    /* fail open */
  }
  process.stdout.write(raw);
  process.exit(0);
}
