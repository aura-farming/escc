#!/usr/bin/env node
/*
 * pre:bash:dispatcher — slim Bash preflight chain (NEW for ESCC; the ECC
 * bash-hook-dispatcher's engineering checks — tmux, commit-quality, push — are
 * out of scope here). Two guards:
 *   1. destructive-command guard — block `rm -rf` (recursive+force) targeting a
 *      path outside a temp dir.
 *   2. CLI bulk-mail guard — CLI mail bypasses the MCP outbound-send-gate; WARN
 *      on a single mail-CLI send, BLOCK an obvious bulk-mail pattern.
 *
 * Failure policy: fails OPEN (exit 0) on any error or truncated payload. It
 * actively BLOCKS (exit 2) the two patterns above.
 */

'use strict';

const { parseHookInput, getToolInput } = require('../lib/hook-input');

function getCommand(toolInput) {
  return String(toolInput.command || toolInput.cmd || toolInput.script || '');
}

/** Split a compound command line into its constituent simple commands. */
function splitCommands(command) {
  return command
    .split(/(?:&&|\|\||[;\n|])/)
    .map(s => s.trim())
    .filter(Boolean);
}

const TMP_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/', './tmp/', 'tmp/'];
function looksLikeTmp(target) {
  const t = target.replace(/^["']|["']$/g, '');
  if (/\$\{?TMPDIR\}?/.test(t)) return true;
  return TMP_PREFIXES.some(prefix => t === prefix.replace(/\/$/, '') || t.startsWith(prefix));
}

const DANGEROUS_BARE = new Set(['/', '~', '$HOME', '${HOME}', '.', '..', '*', '/*', '~/*']);

/**
 * Does this simple command perform a recursive+force rm outside a temp dir?
 * @returns {{block:boolean, target?:string}}
 */
function inspectRm(simpleCommand) {
  const tokens = simpleCommand.split(/\s+/).filter(Boolean);
  // skip leading env assignments (FOO=bar) and sudo
  let i = 0;
  while (i < tokens.length && (/^\w+=/.test(tokens[i]) || tokens[i] === 'sudo')) i += 1;
  if (tokens[i] !== 'rm') return { block: false };

  const flagTokens = tokens.slice(i + 1).filter(t => t.startsWith('-'));
  const targets = tokens.slice(i + 1).filter(t => !t.startsWith('-'));
  // Short combined flags (-rf, -fr, -r) contribute their letters; long flags
  // (--recursive, --force) are matched whole. Avoid scanning long-flag letters
  // (e.g. the "r" inside "--force") by separating the two.
  const shortFlagChars = flagTokens.filter(t => /^-[^-]/.test(t)).join('').replace(/-/g, '');
  const longFlags = flagTokens.filter(t => t.startsWith('--'));
  const recursive = shortFlagChars.includes('r') || longFlags.includes('--recursive');
  const force = shortFlagChars.includes('f') || longFlags.includes('--force');
  if (!(recursive && force)) return { block: false };

  // recursive+force rm. Allow only when EVERY target is clearly a temp path.
  if (targets.length === 0) return { block: true, target: '(no explicit target)' };
  for (const target of targets) {
    if (DANGEROUS_BARE.has(target)) return { block: true, target };
    if (!looksLikeTmp(target)) return { block: true, target };
  }
  return { block: false };
}

const MAIL_CLI = /\b(sendmail|swaks|mailx|ssmtp)\b|\bmail\s+-s\b|\bmutt\s+-s\b/i;
const MAIL_API_CURL = /\bcurl\b[^\n]*\b(api\.mailgun|api\.sendgrid|api\.postmarkapp|email\.[a-z0-9-]+\.amazonaws)\b/i;
const BULK_PATTERN = /\b(for|while|xargs|parallel)\b|<\s*[\w./-]*(recipients|emails|leads|contacts|list)/i;

/**
 * @param {string|object} raw
 * @param {{truncated?: boolean}} [ctx]
 * @returns {{exitCode:number, stderr?:string}|{additionalContext:string}|undefined}
 */
function run(raw, ctx = {}) {
  try {
    if (ctx && ctx.truncated) return undefined; // fail open

    const command = getCommand(getToolInput(parseHookInput(raw)));
    if (!command.trim()) return undefined;

    // 1. destructive rm guard
    for (const simple of splitCommands(command)) {
      const verdict = inspectRm(simple);
      if (verdict.block) {
        return {
          exitCode: 2,
          stderr:
            `[bash-dispatcher] BLOCKED: refusing 'rm -rf' on a non-temp path (${verdict.target}). ` +
            'Recursive force-delete outside a temp directory is destructive and irreversible. ' +
            'Delete a specific path explicitly, or operate under /tmp.',
        };
      }
    }

    // 2. CLI bulk-mail guard
    const usesMailCli = MAIL_CLI.test(command) || MAIL_API_CURL.test(command);
    if (usesMailCli) {
      if (BULK_PATTERN.test(command)) {
        return {
          exitCode: 2,
          stderr:
            '[bash-dispatcher] BLOCKED: this looks like a CLI bulk-mail send (mail CLI + loop/recipient-list). ' +
            'CLI mail bypasses the outbound-send-gate and its review + ESCC_BULK_SEND_MAX cap. ' +
            'Send through a reviewed MCP draft/send flow instead.',
        };
      }
      return {
        additionalContext:
          '⚠️ bash-dispatcher: a command-line mail tool was detected. CLI mail bypasses the outbound-send-gate ' +
          '(no review-evidence check, no bulk cap). Prefer a reviewed MCP draft/send so the send is gated and logged.',
      };
    }

    return undefined;
  } catch (_err) {
    return { exitCode: 0 }; // fail open
  }
}

module.exports = { run, inspectRm, splitCommands, looksLikeTmp };

if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_err) { raw = ''; }
  const truncated = /^(1|true|yes)$/i.test(String(process.env.ESCC_HOOK_INPUT_TRUNCATED || ''));
  let result;
  try { result = run(raw, { truncated }); } catch (_err) { result = { exitCode: 0 }; }
  if (result && result.stderr) process.stderr.write(`${result.stderr}\n`);
  if (result && result.exitCode === 2) process.exit(2);
  process.stdout.write(raw);
  process.exit(0);
}
