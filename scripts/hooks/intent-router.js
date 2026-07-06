#!/usr/bin/env node
/*
 * ESCC prompt:intent-router — deterministic skill routing hint (NEW for ESCC;
 * ADR-0016).
 *
 * Claude Code auto-invokes skills from their frontmatter descriptions, but that
 * listing lives under a context budget — on small-context models parts of a
 * large catalog lose their trigger text. This UserPromptSubmit hook is the
 * budget-INDEPENDENT routing layer: it keyword-matches the user's prompt
 * against config/skill-keywords.json (priority-ordered, compliance first,
 * specific before general) and injects ONE one-line hint naming the likely
 * skill. The model decides; the hint only surfaces the candidate.
 *
 * Failure policy: PURE HINT — never blocks, never rewrites the prompt. Skips
 * prompts that are already routed (slash commands, explicit escc:<skill>
 * mentions) and very short prompts. Fails OPEN (exit 0) on any internal error.
 */
/**
 * prompt:intent-router
 *   matcher: * (UserPromptSubmit)
 *   profiles: standard, strict
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseHookInput } = require('../lib/hook-input');

const CONFIG_RELATIVE = path.join('config', 'skill-keywords.json');
// Scan caps: enough for any real ask; a pasted 50k-char email tail is ignored.
const MAX_SCAN_CHARS = 2000;
const MIN_PROMPT_CHARS = 12;

let cachedRoutes = null;
let cachedRoot = null;

/** Load + compile the routing table once per root. Fails open to []. */
function loadRoutes(pluginRoot) {
  const root = pluginRoot || path.resolve(__dirname, '..', '..');
  if (cachedRoutes && cachedRoot === root) return cachedRoutes;
  cachedRoot = root;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, CONFIG_RELATIVE), 'utf8'));
    const routes = Array.isArray(parsed.routes) ? parsed.routes : [];
    cachedRoutes = routes
      .map((r) => {
        const regexes = [];
        for (const p of Array.isArray(r.patterns) ? r.patterns : []) {
          try {
            regexes.push(new RegExp(p, 'i'));
          } catch (_err) {
            /* skip an invalid pattern — the rest of the route still works */
          }
        }
        return { skill: r.skill || '', command: r.command || '', hint: r.hint || '', regexes };
      })
      .filter((r) => r.skill && r.regexes.length);
  } catch (_err) {
    cachedRoutes = [];
  }
  return cachedRoutes;
}

/** Pull the prompt text across the field-name variants Claude Code uses. */
function getPromptText(input) {
  for (const key of ['prompt', 'user_input', 'user_message']) {
    if (input && typeof input[key] === 'string' && input[key].trim()) return input[key];
  }
  return '';
}

/**
 * A prompt that is already routed gets NO hint: slash commands carry their own
 * skill, an explicit escc:<skill> mention means the user chose, and a very
 * short prompt has too little signal to match precisely.
 */
function shouldSkip(prompt) {
  const trimmed = String(prompt || '').trim();
  if (trimmed.length < MIN_PROMPT_CHARS) return true;
  if (trimmed.startsWith('/')) return true;
  if (/\bescc:[a-z0-9-]+/i.test(trimmed)) return true;
  return false;
}

/** First matching route wins — the table is priority-ordered. */
function matchRoute(prompt, routes) {
  const text = String(prompt || '').slice(0, MAX_SCAN_CHARS);
  for (const route of routes) {
    if (route.regexes.some((re) => re.test(text))) return route;
  }
  return null;
}

function buildHint(route) {
  const cmd = route.command ? ` (${route.command})` : '';
  return (
    `🧭 escc intent-router: this looks like a job for the escc:${route.skill} skill${cmd}` +
    ` — ${route.hint} (Deterministic keyword hint; ignore it if it misreads the ask.)`
  );
}

/**
 * @param {string|object} raw UserPromptSubmit event JSON
 * @param {{pluginRoot?: string}} [ctx]
 * @returns {{additionalContext:string}|{exitCode:number}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    const input = parseHookInput(raw);
    const prompt = getPromptText(input);
    if (shouldSkip(prompt)) return undefined;
    const route = matchRoute(prompt, loadRoutes(ctx.pluginRoot));
    if (!route) return undefined;
    return { additionalContext: buildHint(route) };
  } catch (_err) {
    return { exitCode: 0 }; // fail OPEN — a routing hint must never block a prompt
  }
}

module.exports = { run, loadRoutes, matchRoute, shouldSkip, buildHint, getPromptText };

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
