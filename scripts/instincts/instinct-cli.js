#!/usr/bin/env node
/*
 * ESCC instinct CLI (NEW for ESCC; concept adapted from ECC
 * continuous-learning-v2's instinct-cli.py — ESCC does a Node rewrite, deps =
 * ajv only).
 *
 * The logic behind the instinct slash-commands. Each handler returns a uniform
 * { code, text, data } so the thin command shims (and, later, scripts/escc.js)
 * can mount them without re-implementing anything:
 *   /instinct-status   -> status()   list instincts + the I7 approve/reject gate
 *   /instinct-promote  -> promote()  manager-gated personal->team (I5)
 *   /evolve            -> evolve()   graduate high-confidence domains (I6)
 */

'use strict';

const store = require('./instinct-store');
const lifecycle = require('./lifecycle');

function formatInstinctLine(instinct, { pending } = {}) {
  const conf = typeof instinct.confidence === 'number' ? instinct.confidence : '?';
  return `  [${instinct.domain}] ${instinct.id} (conf ${conf})${pending ? '  PENDING REVIEW' : ''}`;
}

/**
 * /instinct-status — list instincts and action the I7 review gate.
 * @param {{scope?: string, approve?: string, reject?: string}} [opts]
 */
function status(opts = {}) {
  try {
    if (opts.reject) lifecycle.rejectInstinct(opts.reject, { scope: opts.scope || 'personal' });
    if (opts.approve) lifecycle.approveInstinct(opts.approve);
  } catch (err) {
    // An unsafe id (path traversal) or other store error is a clean refusal,
    // not a crash.
    return { code: 1, text: `Refused: ${err.message}`, data: null };
  }

  const personal = store.readInstincts('personal');
  const team = store.readInstincts('team');
  const pendingList = lifecycle.listForReview({ scope: 'personal' }).map(i => i.id);
  const pending = new Set(pendingList);

  const lines = [`Instincts (workspace ${store.workspaceId()}):`, `Personal (${personal.length}):`];
  for (const i of personal) lines.push(formatInstinctLine(i, { pending: pending.has(i.id) }));
  lines.push(`Team (${team.length}):`);
  for (const i of team) lines.push(formatInstinctLine(i, { pending: false }));
  if (pendingList.length) {
    lines.push('', `${pendingList.length} pending review — approve with: /instinct-status --approve <id>, reject with: --reject <id>`);
  }

  return { code: 0, text: lines.join('\n'), data: { personal, team, pending: pendingList } };
}

/**
 * /instinct-promote <id> — manager-gated promotion to team scope (I5).
 * @param {string} id
 * @param {{role?: string, fromScope?: string}} [opts]
 */
function promote(id, opts = {}) {
  if (!id) return { code: 1, text: 'Usage: /instinct-promote <instinct-id>', data: null };
  const role = opts.role ?? lifecycle.resolveRole();
  const res = lifecycle.promoteInstinct(id, { role, fromScope: opts.fromScope });
  if (res.promoted) {
    return { code: 0, text: `Promoted ${id} to team scope.`, data: res };
  }
  const text = res.reason === 'role_required'
    ? `Refused: promoting an instinct to team scope requires a manager role (current role: ${role}). There is no automatic promotion.`
    : `Refused: instinct '${id}' not found in the personal library.`;
  return { code: 1, text, data: res };
}

/**
 * /evolve — graduate qualifying domains into evolved-skill drafts (I6).
 * @param {{now?: string, scope?: string}} [opts]
 */
function evolve(opts = {}) {
  const res = lifecycle.evolve({ now: opts.now, scope: opts.scope });
  const text = res.wrote.length
    ? `Evolved ${res.wrote.length} artifact(s) (DRAFT — route through validators before use):\n${res.wrote.map(p => `  ${p}`).join('\n')}`
    : 'No domains met the evolve threshold (>=3 instincts, avg confidence >=0.7).';
  return { code: 0, text, data: res };
}

/** Parse the small flag set the instinct commands accept. */
function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--approve') flags.approve = args[(i += 1)];
    else if (a === '--reject') flags.reject = args[(i += 1)];
    else if (a === '--role') flags.role = args[(i += 1)];
    else if (a === '--scope') flags.scope = args[(i += 1)];
    else positional.push(a);
  }
  return { flags, positional };
}

/** Thin argv dispatcher. @returns {{code:number, text:string, data:*}} */
function run(argv = []) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  switch (command) {
    case 'status':
    case 'instinct-status':
      return status(flags);
    case 'promote':
    case 'instinct-promote':
      return promote(positional[0], flags);
    case 'evolve':
      return evolve(flags);
    default:
      return { code: 1, text: `Unknown command: ${command || '(none)'}. Try: status | promote <id> | evolve`, data: null };
  }
}

module.exports = { status, promote, evolve, run, parseFlags, formatInstinctLine };

if (require.main === module) {
  const res = run(process.argv.slice(2));
  process.stdout.write(`${res.text}\n`);
  process.exit(res.code);
}
