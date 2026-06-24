#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/hooks/run-with-flags.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*; the hardcoded 1MB stdin cap is now configurable
 * via ESCC_HOOK_INPUT_MAX_BYTES (still a fail-open control).
 */
/**
 * Executes a hook script only when enabled by ESCC hook profile flags, then
 * forwards its verdict back to the harness. This is THE dispatch runner: every
 * entry in hooks/hooks.json routes through it.
 *
 * Usage:
 *   node run-with-flags.js <hookId> <scriptRelativePath> [profilesCsv]
 *
 * Failure policy: fail-open. On oversized stdin, missing args, a disabled hook,
 * a path-traversal attempt, a missing script, or a thrown error, the runner
 * emits exit 0 and never echoes a truncated payload — leaving the tool call
 * unblocked. The hook itself may still choose to block (e.g. the fail-CLOSED
 * outbound-send-gate), which the runner forwards faithfully.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isHookEnabled, FAIL_CLOSED_HOOKS } = require('../lib/hook-flags');
const { buildAdditionalContext, normalizeAdditionalContext } = require('./pretooluse-visible-output');

const DEFAULT_MAX_STDIN = 1024 * 1024;

// FAIL_CLOSED_HOOKS is the canonical set from hook-flags.js (pre:outbound-send-gate).
// CLAUDE.md §4: every hook fails open EXCEPT the send-gate, which fails CLOSED. The
// gate's own run() already blocks on any internal error, but if the hook cannot run
// to a verdict at all — its module fails to load (e.g. a missing dependency such as
// an absent ajv in a marketplace install), run() throws, the legacy child crashes,
// or the runner cannot even locate/admit the script (missing file, path traversal) —
// the runner itself blocks (exit 2) rather than let the tool call through. A
// fail-closed hook is also non-disableable (enforced in hook-flags.isHookEnabled),
// so the disabled-hook branch below is never reached for it.

/**
 * Emit a blocking PreToolUse verdict (exit 2) for a fail-closed hook that could
 * not produce one itself. The reason goes to stderr (what exit 2 feeds back to
 * the model); stdout stays empty. Terminal — calls process.exit(2).
 */
function failClosedBlock(hookId, detail) {
  process.stderr.write(
    `[Hook] BLOCKED (fail-closed): ${hookId} could not produce a verdict — ${detail}. `
    + 'Refusing the tool call to stay safe. '
    + '(Set ESCC_OUTBOUND_GATE=off to override the outbound gate if you understand the risk.)\n'
  );
  process.exit(2);
}

/**
 * Resolve the stdin cap. ESCC_HOOK_INPUT_MAX_BYTES overrides the 1MB default;
 * a missing, non-numeric, or non-positive value falls back to the default.
 */
function getMaxStdin() {
  const raw = process.env.ESCC_HOOK_INPUT_MAX_BYTES;
  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_MAX_STDIN;
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_STDIN;
}

function readStdinRaw(maxStdin) {
  return new Promise(resolve => {
    let raw = '';
    let truncated = false;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (raw.length < maxStdin) {
        const remaining = maxStdin - raw.length;
        raw += chunk.substring(0, remaining);
        if (chunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });
    process.stdin.on('end', () => resolve({ raw, truncated }));
    process.stdin.on('error', () => resolve({ raw, truncated }));
  });
}

function writeStderr(stderr) {
  if (typeof stderr !== 'string' || stderr.length === 0) {
    return;
  }

  process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
}

/**
 * Write stdout fully, then exit. `process.exit()` immediately after
 * `process.stdout.write()` drops anything beyond the ~64KB pipe buffer,
 * which cut large pass-through payloads mid-JSON and made the harness
 * treat the hook as failed (#2222). The write callback fires only after
 * the chunk is flushed to the pipe.
 */
function exitWithStdout(text, exitCode) {
  if (typeof text !== 'string' || text.length === 0) {
    process.exit(exitCode);
  }
  process.stdout.write(text, () => process.exit(exitCode));
}

// Events whose hook response may carry hookSpecificOutput.additionalContext
// (text injected back into the model). For any other event (Stop, SubagentStop,
// PreCompact, SessionEnd, Notification), Claude Code rejects an additionalContext
// response because its hookEventName cannot match the firing event.
const ADDITIONAL_CONTEXT_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
]);

// Fallback event-name derivation from the hookId prefix, used only when the
// stdin payload omits hook_event_name. Order matters: pre:compact before pre:.
const HOOK_ID_EVENT_PREFIXES = [
  [/^post:/, 'PostToolUse'],
  [/^pre:compact/, 'PreCompact'],
  [/^pre:/, 'PreToolUse'],
  [/^stop:/, 'Stop'],
  [/^session:start/, 'SessionStart'],
  [/^session:end/, 'SessionEnd'],
];

/**
 * Resolve the firing hook event. Authoritative source: hook_event_name in the
 * stdin payload (what Claude Code declares and validates the response against);
 * falls back to the hookId prefix, then to PreToolUse (the legacy default).
 */
function resolveHookEventName(raw, hookId) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.hook_event_name === 'string' && parsed.hook_event_name.trim()) {
      return parsed.hook_event_name.trim();
    }
  } catch (_err) {
    /* not JSON — fall back to the hookId prefix */
  }
  const id = String(hookId || '');
  for (const [re, evt] of HOOK_ID_EVENT_PREFIXES) {
    if (re.test(id)) return evt;
  }
  return 'PreToolUse';
}

function resolveHookResult(raw, output, eventName) {
  if (typeof output === 'string' || Buffer.isBuffer(output)) {
    return { stdout: String(output), exitCode: 0 };
  }

  if (output && typeof output === 'object') {
    writeStderr(output.stderr);
    const exitCode = Number.isInteger(output.exitCode) ? output.exitCode : 0;

    if (Object.prototype.hasOwnProperty.call(output, 'additionalContext')) {
      // additionalContext is injected back into the model's context, which only
      // ADDITIONAL_CONTEXT_EVENTS support. For Stop/SubagentStop/etc., emitting it
      // as hookSpecificOutput makes Claude Code reject the response (hookEventName
      // mismatch) — instead surface the text as a non-blocking stderr note.
      if (ADDITIONAL_CONTEXT_EVENTS.has(eventName)) {
        return { stdout: buildAdditionalContext(output.additionalContext, eventName), exitCode };
      }
      writeStderr(normalizeAdditionalContext(output.additionalContext));
      return { stdout: '', exitCode };
    }
    if (Object.prototype.hasOwnProperty.call(output, 'stdout')) {
      return { stdout: String(output.stdout ?? ''), exitCode };
    }
    return { stdout: exitCode === 0 ? raw : '', exitCode };
  }

  return { stdout: raw, exitCode: 0 };
}

function resolveLegacySpawnStdout(raw, result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (stdout) {
    return stdout;
  }

  if (Number.isInteger(result.status) && result.status === 0) {
    return raw;
  }

  return '';
}

function getPluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.trim()) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  return path.resolve(__dirname, '..', '..');
}

async function main() {
  const [, , hookId, relScriptPath, profilesCsv] = process.argv;
  const maxStdin = getMaxStdin();
  const { raw, truncated } = await readStdinRaw(maxStdin);

  // Oversized payloads: never echo the truncated string — a JSON document
  // cut mid-stream is treated by the harness as a hook failure, blocking the
  // tool call (#2222). Empty stdout + exit 0 means "no opinion", so
  // pass-through paths fail open. The hook itself still runs and receives
  // the truncated flag (run() context / ESCC_HOOK_INPUT_TRUNCATED), so
  // security hooks like compliance-protection can still choose to block.
  const sanitizeEcho = text => (truncated && text === raw ? '' : text);
  if (truncated) {
    process.stderr.write(`[Hook] stdin exceeded ${maxStdin} bytes for ${hookId || 'unknown'}; suppressing pass-through (fail-open unless the hook blocks)\n`);
  }

  if (!hookId || !relScriptPath) {
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (!isHookEnabled(hookId, { profiles: profilesCsv })) {
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  const pluginRoot = getPluginRoot();
  const resolvedRoot = path.resolve(pluginRoot);
  const scriptPath = path.resolve(pluginRoot, relScriptPath);

  // Prevent path traversal outside the plugin root
  if (!scriptPath.startsWith(resolvedRoot + path.sep)) {
    process.stderr.write(`[Hook] Path traversal rejected for ${hookId}: ${scriptPath}\n`);
    if (FAIL_CLOSED_HOOKS.has(hookId)) {
      failClosedBlock(hookId, 'its hook script path was rejected (traversal)');
    }
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`[Hook] Script not found for ${hookId}: ${scriptPath}\n`);
    if (FAIL_CLOSED_HOOKS.has(hookId)) {
      failClosedBlock(hookId, 'its hook script was not found');
    }
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  // Prefer direct require() when the hook exports a run(rawInput) function.
  // This eliminates one Node.js process spawn (~50-100ms savings per hook).
  //
  // SAFETY: Only require() hooks that export run(). Legacy hooks execute
  // side effects at module scope (stdin listeners, process.exit, main() calls)
  // which would interfere with the parent process or cause double execution.
  let hookModule;
  const src = fs.readFileSync(scriptPath, 'utf8');
  const hasRunExport = /\bmodule\.exports\b/.test(src) && /\brun\b/.test(src);

  if (hasRunExport) {
    try {
      hookModule = require(scriptPath);
    } catch (requireErr) {
      process.stderr.write(`[Hook] require() failed for ${hookId}: ${requireErr.message}\n`);
      if (FAIL_CLOSED_HOOKS.has(hookId)) {
        failClosedBlock(hookId, `its module failed to load (${requireErr.message})`);
      }
      // Fall through to legacy spawnSync path
    }
  }

  if (hookModule && typeof hookModule.run === 'function') {
    try {
      const output = hookModule.run(raw, {
        hookId,
        pluginRoot,
        scriptPath,
        truncated,
        maxStdin
      });
      const result = resolveHookResult(raw, output, resolveHookEventName(raw, hookId));
      exitWithStdout(sanitizeEcho(result.stdout), result.exitCode);
    } catch (runErr) {
      process.stderr.write(`[Hook] run() error for ${hookId}: ${runErr.message}\n`);
      if (FAIL_CLOSED_HOOKS.has(hookId)) {
        failClosedBlock(hookId, `run() threw (${runErr.message})`);
      }
      exitWithStdout(sanitizeEcho(raw), 0);
    }
    return;
  }

  // Legacy path: spawn a child Node process for hooks without run() export
  const result = spawnSync(process.execPath, [scriptPath], {
    input: raw,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ESCC_PLUGIN_ROOT: pluginRoot,
      ESCC_HOOK_ID: hookId,
      ESCC_HOOK_INPUT_TRUNCATED: truncated ? '1' : '0',
      ESCC_HOOK_INPUT_MAX_BYTES: String(maxStdin)
    },
    cwd: process.cwd(),
    timeout: 30000
  });

  const legacyStdout = sanitizeEcho(resolveLegacySpawnStdout(raw, result));
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error || result.signal || result.status === null) {
    const failureDetail = result.error ? result.error.message : result.signal ? `terminated by signal ${result.signal}` : 'missing exit status';
    writeStderr(`[Hook] legacy hook execution failed for ${hookId}: ${failureDetail}`);
    if (FAIL_CLOSED_HOOKS.has(hookId)) {
      failClosedBlock(hookId, `its legacy child failed (${failureDetail})`);
    }
    exitWithStdout(legacyStdout, 1);
    return;
  }

  const status = Number.isInteger(result.status) ? result.status : 0;
  // A fail-closed hook's legacy child may legitimately exit 0 (allow) or 2 (block);
  // any other status is a crash, not a verdict → block instead of failing open.
  if (FAIL_CLOSED_HOOKS.has(hookId) && status !== 0 && status !== 2) {
    failClosedBlock(hookId, `its legacy child exited ${status} without a verdict`);
  }
  exitWithStdout(legacyStdout, status);
}

main().catch(err => {
  process.stderr.write(`[Hook] run-with-flags error: ${err.message}\n`);
  process.exit(0);
});
