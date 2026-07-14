#!/usr/bin/env node
'use strict';

/*
 * escc — the ESCC operator CLI dispatcher (spec §6.6 + §A.6).
 *
 * NEW for ESCC: a single entrypoint consolidating capabilities ECC spreads
 * across many scripts/*.js (auto-update, catalog, session-inspect, ...). Every
 * subcommand returns the uniform { code, text, data } contract, so handlers are
 * directly testable and the instinct slash-command handlers mount unchanged.
 *
 * Subcommands: install · plan · catalog · doctor · repair · status ·
 * sessions · list-installed · uninstall · auto-update · privacy-purge · watch ·
 * outbound · product, plus the mounted instinct handlers (instinct-status /
 * instinct-promote / evolve) from scripts/instincts/instinct-cli.js.
 *
 * The dispatcher delegates to already-tested libs; it never re-implements their
 * logic. Heavy/destructive work (install apply, privacy erasure, git pull) is
 * gated by the libs themselves (dry-run defaults, --confirm, injectable git).
 */

const fs = require('fs');

const installer = require('./install');
const manifests = require('./lib/install-manifests');
const lifecycle = require('./lib/install-lifecycle');
const purgeLib = require('./lib/privacy-purge');
const watchLib = require('./lib/trigger-watch');
const autoUpdateLib = require('./lib/auto-update');
const sessionMgr = require('./lib/session-manager');
const instinctCli = require('./instincts/instinct-cli');
const instinctStore = require('./instincts/instinct-store');
const outboundApprove = require('./lib/outbound-approve');
const outboundGates = require('./lib/outbound-gates');
const worklist = require('./lib/worklist');
const productKnowledge = require('./lib/product-knowledge');
const productMine = require('./lib/product-mine');
const accountRegister = require('./lib/account-register');
const voiceOverlay = require('./lib/voice-overlay');
const accountIdentity = require('./lib/account-identity');
const accountReconcile = require('./lib/account-reconcile');
const accountTruth = require('./lib/account-truth');

const HELP = `escc — EverythingSales Claude Code operator CLI

Usage: escc <command> [options]

Install / lifecycle:
  install         resolve a plan and apply it (--target --profile --home --repo-root [--dry-run])
  plan            dry-run resolution only (writes nothing)
  catalog         list install profiles / modules / components (--repo-root)
  doctor          check installed targets for drift vs install-state (--exit-code)
  repair          restore drifted/missing managed files from source
  status          harness + install + workspace summary (--markdown --write <path> --exit-code)
  sessions        list recent saved sessions (--limit <n>)
  list-installed  list managed targets discovered in this context
  uninstall       remove managed files + install-state for the target
  auto-update     git pull + reapply each managed target (--dry-run)

Workspace / data:
  privacy-purge <identifier>  erase a subject across local stores (DRY-RUN unless --confirm / --yes)
  watch                       one read-only signal sweep (overdue promises + closing deals) -> notify
  watch --emit-schedule       print the launchd plist + crontab line for a scheduled sweep (--interval 1h|30m)
  watch --install-schedule    write the launchd plist to ~/Library/LaunchAgents (macOS; prints the load command)
  notify drain                print + hand off queued notifications ([--clear]; --approve-self <your-email> mints a
                              self-digest approval token so the gate admits the matching Gmail draft)

Outbound enforcement (v1.1.0; adversarial review required per ADR-0020):
  outbound approve       four gates + adversarial-review check, then record a per-recipient approval
                         token. --input <json> = {draft,records,review:{verdict,confidence}} — or pass
                         --review-verdict approved --review-confidence 0.9 [--reviewer outbound-reviewer].
                         [--override "<reason>"] [--approver "<name>"] [--approver-role <role>] — strict
                         profile requires manager-signed overrides; ESCC_OUTBOUND_REQUIRE_REVIEW=off disables.
  outbound check         run the four gates read-only, no writes (--input <json>)
  outbound review-pack   split a worklist into sendable vs excluded-with-reasons (--input <json>)

Product knowledge (ADR-0012):
  product retrieve     run the role+segment+competitor ladder (--role --segment --competitor --type --use-case)
  product resolve-role <job title>  map a HubSpot job title to a controlled role
  product add          add an entry (--input <json>); approved if --approved-by "<name>", else a candidate
  product approve      promote a candidate to approved (--id <id> --approved-by "<name>")
  product candidates   list candidates awaiting operator review
  product gaps         list logged knowledge gaps (clean misses)
  product mine         ingest candidates (--input <json>) or mine a transcript (--from-transcript <file> [--source-ref <ref>])
  product vocab show     show the active controlled vocabulary + its source (inline|workspace|shipped|fallback)
  product vocab init     copy the generic template into your gitignored workspace override (--force to overwrite)
  product vocab suggest  suggest segment slugs from CRM industries (--input '{"industries":[...]}')

Per-account voice overlay (ADR-0015):
  voice account <id>   build/refresh the per-account STYLE overlay from BUYER texts (--input '{"texts":[...]}')
  voice show <id>      print the per-account voice overlay

Canonical account identity (ADR-0018):
  identity resolve <id>            show the canonical key for any name/domain/email/id
  identity link <alias> <canon>    link an alias to its canonical id (e.g. "Example Co" company:<hubspot-id>)
  identity list                    list all alias links
  identity backfill [--apply]      merge legacy store fragments into canonical keys (DRY-RUN default; --apply backs up first)
  reconcile <account> [--apply]    diff account-memory vs a live CRM snapshot (--input '{"deals":[...]}'); --apply syncs memory to CRM
                                    (batch: --input '{"accounts":[{"account":"company:1","deals":[...]}]}' reconciles the whole morning sweep)

Prepared day (v1.9.0):
  worklist list [--all]            show prepared-day items (default: open); the morning sweep stages them, /daily surfaces them
  worklist add --account <id> [--kind <k>] [--meeting <iso>] [--skill <s>]   stage a prepared item
  worklist done <id>               mark a prepared item worked
  twin [--days <n>]                what the twin learned/staged lately (outcomes, prepared items, candidates, pending instincts) + where to correct each

Account truth & audit (v1.8.0):
  truth <account> [--input <crm.json>]   THE reconciled account picture — every section labeled source + last-verified
  audit [--recipient <r>] [--account <id>] [--event-type <t>] [--since <iso>] [--json]
                                          query/export the outbound governance ledger (compliance proof)

Outcome ledger (v1.8.0 learning loop):
  outcome record --type <t>   attest an outcome (reply_received | meeting_booked | deal_stage_advanced | sequence_step_engaged | closed_won | closed_lost) [--account <id>] [--deal <id>] [--thread <id>] [--note "<why>"]
                              (--thread dedupes: the same reply attested twice collapses to one row)
  outcome list                list recorded outcomes (--type, --account, --limit)
  outcome void <id>           roll back a bad/fabricated outcome — excluded from distill, truth, and summary everywhere (v1.9.0)
  outcome summary             ledger counts by type + the session follow-through gap (coaching input)

Instinct engine (mounted from instinct-cli):
  instinct-status         list instincts + the review gate (--approve <id> / --reject <id>)
  instinct-promote <id>   manager-gated personal -> team promotion (--role <role>)
  evolve                  graduate high-confidence domains into evolved-skill drafts

  help            show this message`;

const VALUE_FLAGS = new Set([
  '--target', '--profile', '--home', '--repo-root', '--write',
  '--limit', '--days', '--within-days', '--role', '--scope', '--approve', '--reject',
  '--input', '--override',
  '--id', '--type', '--segment', '--competitor', '--approved-by',
  '--source-ref', '--source-type', '--use-case', '--from-transcript',
  '--account', '--deal', '--note', '--recipient', '--since', '--event-type',
  '--approver', '--approver-role', '--review-verdict', '--review-confidence', '--reviewer', '--interval', '--approve-self',
  '--thread', '--kind', '--meeting', '--skill', '--crm-as-of',
]);

/** `--repo-root` -> `repoRoot`, `--within-days` -> `withinDays`. */
function camel(flag) {
  return flag.replace(/^--/, '').split('-')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** Parse the tail args into { flags, positional }. */
function parseArgs(rest = []) {
  const flags = {};
  const positional = [];
  const errors = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--markdown') flags.markdown = true;
    else if (a === '--exit-code') flags.exitCode = true;
    else if (a === '--confirm' || a === '--yes') flags.confirm = true;
    else if (VALUE_FLAGS.has(a)) {
      const value = rest[i + 1];
      if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
        errors.push(`Flag ${a} requires a value`);
      } else {
        flags[camel(a)] = value;
        i += 1;
      }
    } else if (a.startsWith('--')) flags[camel(a)] = true; // tolerate unknown boolean flags
    else positional.push(a);
  }
  return { flags, positional, errors };
}

function idsOf(list) {
  if (Array.isArray(list)) {
    return list.map(x => (x && typeof x === 'object' ? (x.id || x.name || JSON.stringify(x)) : String(x)));
  }
  if (list && typeof list === 'object') return Object.keys(list);
  return [];
}

function toInstallOpts(flags) {
  return { sourceRoot: flags.repoRoot, homeDir: flags.home, target: flags.target, profileId: flags.profile, dryRun: flags.dryRun };
}

function toLifecycleOpts(flags) {
  return { repoRoot: flags.repoRoot, homeDir: flags.home, targets: flags.target ? [flags.target] : undefined };
}

// --- handlers ---------------------------------------------------------------

function handleHelp() {
  return { code: 0, text: HELP, data: null };
}

function handleCatalog(flags) {
  try {
    const profiles = manifests.listInstallProfiles({ repoRoot: flags.repoRoot });
    const modules = manifests.listInstallModules({ repoRoot: flags.repoRoot });
    const components = manifests.listInstallComponents({ repoRoot: flags.repoRoot });
    const text = [
      `Profiles (${idsOf(profiles).length}):   ${idsOf(profiles).join(', ') || '(none)'}`,
      `Modules (${idsOf(modules).length}):    ${idsOf(modules).join(', ') || '(none)'}`,
      `Components (${idsOf(components).length}): ${idsOf(components).join(', ') || '(none)'}`,
    ].join('\n');
    return { code: 0, text, data: { profiles, modules, components } };
  } catch (err) {
    return { code: 1, text: `catalog failed: ${err.message} (manifests land in Phase 4)`, data: null };
  }
}

function formatDoctor(report) {
  const s = report.summary || {};
  const results = (report && report.results) || [];
  // A marketplace / plugin-manager install writes no `escc install` file-copy
  // records, so discovery finds nothing. Say so honestly — an empty result is
  // NOT a clean bill of health for a plugin install.
  if (!results.length) {
    return [
      'Doctor: no `escc install` file-copy target records found (0 targets checked).',
      'If you installed ESCC via the Claude Code marketplace / plugin manager, that is expected —',
      'this doctor only checks file-copy installs, not plugin-managed ones. It has NOT verified your plugin.',
      'Verify a plugin install with `/plugin` inside Claude Code; run `escc install` only for a file-copy install.',
    ].join('\n');
  }
  const lines = [`Doctor: ${s.okCount || 0} ok, ${s.errorCount || 0} error(s) across ${results.length} target(s).`];
  for (const r of results) lines.push(`- ${r.adapter ? r.adapter.id : '?'}: ${r.status}`);
  return lines.join('\n');
}

function handleDoctor(flags) {
  try {
    const report = lifecycle.buildDoctorReport(toLifecycleOpts(flags));
    const results = (report && report.results) || [];
    const errors = (report.summary && report.summary.errorCount) || 0;
    // Under --exit-code, "nothing was checked" is not a pass: errors OR zero targets => non-zero.
    const bad = errors > 0 || results.length === 0;
    return { code: flags.exitCode && bad ? 1 : 0, text: formatDoctor(report), data: report };
  } catch (err) {
    return { code: 1, text: `doctor failed: ${err.message}`, data: null };
  }
}

function handleRepair(flags) {
  try {
    const r = lifecycle.repairInstalledStates(toLifecycleOpts(flags));
    return { code: 0, text: `Repaired ${(r.summary && r.summary.repairedCount) || 0} item(s).`, data: r };
  } catch (err) {
    return { code: 1, text: `repair failed: ${err.message}`, data: null };
  }
}

function handleListInstalled(flags) {
  try {
    const records = lifecycle.discoverInstalledStates(toLifecycleOpts(flags)).filter(r => r.exists);
    if (!records.length) return { code: 0, text: 'No ESCC install-state found for this context.', data: { records: [] } };
    const lines = records.map(r => `- ${r.adapter.id} (${r.adapter.target}) — ${r.installStatePath}`);
    return { code: 0, text: `Installed targets (${records.length}):\n${lines.join('\n')}`, data: { records } };
  } catch (err) {
    return { code: 1, text: `list-installed failed: ${err.message}`, data: null };
  }
}

function handleUninstall(flags) {
  try {
    const r = lifecycle.uninstallInstalledStates(toLifecycleOpts(flags));
    return { code: 0, text: `Uninstalled ${(r.summary && r.summary.uninstalledCount) || 0} target(s).`, data: r };
  } catch (err) {
    return { code: 1, text: `uninstall failed: ${err.message}`, data: null };
  }
}

function handleSessions(flags) {
  try {
    const n = flags.limit ? Number(flags.limit) : 10;
    const recent = sessionMgr.listRecentSessions(Number.isFinite(n) ? n : 10);
    if (!recent.length) return { code: 0, text: 'No saved sessions found.', data: { sessions: [] } };
    const lines = recent.map(s => `- ${s.title || s.id || s.filename || '(session)'}${s.date ? ` (${s.date})` : ''}`);
    return { code: 0, text: `Recent sessions (${recent.length}):\n${lines.join('\n')}`, data: { sessions: recent } };
  } catch (err) {
    return { code: 1, text: `sessions failed: ${err.message}`, data: null };
  }
}

/** Compose a fail-soft operator HUD from install + instinct + signal + session state. */
function handleStatus(flags) {
  const data = {};
  const sections = [];

  try {
    const report = lifecycle.buildDoctorReport(toLifecycleOpts(flags));
    data.install = report.summary;
    sections.push(`Install: ${report.summary.okCount} ok, ${report.summary.errorCount} error(s)`);
  } catch (_err) {
    sections.push('Install: (no install-state in this context)');
  }
  try {
    const personal = instinctStore.readInstincts('personal').length;
    const team = instinctStore.readInstincts('team').length;
    data.instincts = { personal, team, workspace: instinctStore.workspaceId() };
    sections.push(`Instincts: ${personal} personal, ${team} team (workspace ${data.instincts.workspace})`);
  } catch (_err) {
    sections.push('Instincts: (unavailable)');
  }
  try {
    const digest = watchLib.sweep({ withinDays: flags.withinDays ? Number(flags.withinDays) : undefined });
    data.signals = { overdue: digest.overduePromises.length, nearClose: digest.nearCloseDeals.length };
    sections.push(`Signals: ${data.signals.overdue} overdue promise(s), ${data.signals.nearClose} deal(s) closing soon`);
  } catch (_err) {
    sections.push('Signals: (unavailable)');
  }
  try {
    const recent = sessionMgr.listRecentSessions(flags.limit ? Number(flags.limit) : 5);
    data.sessions = recent.length;
    sections.push(`Recent sessions: ${recent.length}`);
  } catch (_err) {
    sections.push('Recent sessions: (unavailable)');
  }

  const text = flags.markdown
    ? `# ESCC status\n\n${sections.map(s => `- ${s}`).join('\n')}\n`
    : `ESCC status:\n${sections.map(s => `  ${s}`).join('\n')}`;
  let writeError = null;
  if (flags.write) {
    try { fs.writeFileSync(flags.write, text.endsWith('\n') ? text : `${text}\n`); } catch (err) { writeError = err.message; }
  }
  data.writeError = writeError;
  const code = flags.exitCode && data.install && data.install.errorCount > 0 ? 1 : 0;
  const out = writeError ? `${text}\n(warning: could not write to ${flags.write}: ${writeError})` : text;
  return { code, text: out, data };
}

/** Read the outbound JSON payload from --input <file> or stdin. */
function readOutboundInput(flags) {
  const raw = flags.input ? fs.readFileSync(flags.input, 'utf8') : fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

/** Outbound enforcement helpers: approve / check / review-pack (v1.1.0). */
function handleOutbound(positional, flags) {
  const action = positional[0] || 'check';
  let payload;
  try {
    payload = readOutboundInput(flags);
  } catch (err) {
    return { code: 1, text: `outbound ${action}: could not read JSON input (--input <file> or stdin): ${err.message}`, data: null };
  }
  try {
    if (action === 'approve') {
      // The adversarial-review verdict (ADR-0020) comes from --input {…, review:{…}}
      // or the --review-* flags; it is REQUIRED unless ESCC_OUTBOUND_REQUIRE_REVIEW=off
      // or a logged --override proceeds.
      const reviewInput = payload.review || (
        (flags.reviewVerdict != null || flags.reviewConfidence != null || flags.reviewer != null)
          ? { verdict: flags.reviewVerdict, confidence: flags.reviewConfidence != null ? Number(flags.reviewConfidence) : undefined, reviewer: flags.reviewer }
          : undefined
      );
      const r = outboundApprove.approveOutbound({
        draft: payload.draft, records: payload.records, sessionId: payload.sessionId,
        now: payload.now, override: flags.override || payload.override,
        approver: flags.approver || payload.approver,
        approverRole: flags.approverRole || payload.approverRole,
        review: reviewInput,
      });
      const notes = r.warnings && r.warnings.length ? `\nnotes:\n${r.warnings.map(w => `  - ${w.reason}`).join('\n')}` : '';
      const rev = r.review ? ` [reviewer ${r.review.reviewer} · ${r.review.verdict} · conf ${r.review.confidence}]` : '';
      const text = r.approved
        ? `APPROVED${r.override ? ` (override: ${r.overrideReason})` : ''}${rev} — token recorded for ${r.recipient || '(recipient)'} [key ${r.key.slice(0, 12)}…]${notes}`
        : `BLOCKED — not approved:\n${r.blocks.map(b => `  - ${b.gate}: ${b.reason}`).join('\n')}\nFix and re-run, or add --override "<reason>" to proceed anyway (logged).`;
      return { code: r.approved ? 0 : 1, text, data: r };
    }
    if (action === 'check') {
      const res = outboundGates.evaluateGates({ draft: payload.draft || {}, records: payload.records || {}, now: payload.now });
      const text = res.pass
        ? 'PASS — all four gates clear.'
        : `BLOCKED:\n${res.blocks.map(b => `  - ${b.gate}: ${b.reason}`).join('\n')}`;
      return { code: res.pass ? 0 : 1, text, data: res };
    }
    if (action === 'review-pack') {
      const pack = worklist.buildReviewPack(payload.items || [], { now: payload.now });
      const excl = pack.excluded.length
        ? `\nExcluded:\n${pack.excluded.map(e => `  - ${e.id} (${e.recipient || '?'}): ${e.reasons.join('; ')}`).join('\n')}`
        : '';
      return { code: 0, text: `Review pack: ${pack.sendableCount}/${pack.total} sendable, ${pack.excludedCount} excluded.${excl}`, data: pack };
    }
    return { code: 1, text: `outbound: unknown action '${action}' (approve | check | review-pack)`, data: null };
  } catch (err) {
    return { code: 1, text: `outbound ${action} failed: ${err.message}`, data: null };
  }
}

/** Read a product JSON payload from --input <file> or stdin. */
function readProductInput(flags) {
  const raw = flags.input ? fs.readFileSync(flags.input, 'utf8') : fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

/** Product-knowledge operator verbs: retrieve / resolve-role / add / approve / candidates / gaps / mine (ADR-0012). */
function handleProduct(positional, flags) {
  const action = positional[0] || 'help';
  try {
    if (action === 'retrieve') {
      const r = productKnowledge.retrieve(
        { role: flags.role, segment: flags.segment, competitor: flags.competitor, type: flags.type, useCase: flags.useCase },
        { logGap: true });
      const text = r.found
        ? `${r.entries.length} approved entr${r.entries.length === 1 ? 'y' : 'ies'} at tier '${r.tier}':\n${r.entries.map(e => `  - ${e.id} [${e.type}] ${String(e.text || e.pattern || e.differentiation || '').slice(0, 80)}`).join('\n')}`
        : `${r.sentinel}${r.stale.length ? `\n(stale/unverified, not quotable: ${r.stale.map(e => e.id).join(', ')})` : ''}`;
      return { code: 0, text, data: r };
    }
    if (action === 'resolve-role') {
      const title = positional[1] || '';
      const role = productKnowledge.resolveRole(title);
      return { code: 0, text: `role: ${role}`, data: { title, role } };
    }
    if (action === 'vocab') {
      const sub = positional[1] || 'show';
      if (sub === 'show') {
        const source = productKnowledge.vocabSource();
        const v = productKnowledge.loadVocab();
        const text = [
          `Controlled vocabulary (source: ${source}).`,
          `  roles (${(v.roles || []).length}): ${(v.roles || []).join(', ') || '(none)'}`,
          `  segments (${(v.segments || []).length}): ${(v.segments || []).join(', ') || '(none)'}`,
          `  competitors (${(v.competitors || []).length}): ${(v.competitors || []).join(', ') || '(none)'}`,
          `  title_to_role rules: ${(v.title_to_role || []).length}, fallback_role: ${v.fallback_role || 'general'}`,
        ].join('\n');
        return { code: 0, text, data: { source, vocab: v } };
      }
      if (sub === 'init') {
        const res = productKnowledge.initWorkspaceVocab(Boolean(flags.force));
        return res.created
          ? { code: 0, text: `Created workspace vocab override at ${res.path}. Edit it to add your competitors/segments/titles — it survives plugin updates and is gitignored.`, data: res }
          : { code: 1, text: `Workspace vocab already exists at ${res.path}. Re-run with --force to overwrite it from the shipped template.`, data: res };
      }
      if (sub === 'suggest') {
        let input;
        try { input = readProductInput(flags); } catch (err) {
          return { code: 1, text: `product vocab suggest: could not read JSON input (--input <file> or stdin): ${err.message}`, data: null };
        }
        const industries = Array.isArray(input) ? input : (input.industries || input.segments || []);
        const { suggested } = productKnowledge.suggestSegments(industries);
        const text = suggested.length
          ? `Suggested segment slug(s) (${suggested.length}): ${suggested.join(', ')}\nReview, then add the ones you want to your workspace vocab (escc product vocab init, then edit segments).`
          : 'No new segment suggestions (input empty, all duplicates, or all resolved to "general").';
        return { code: 0, text, data: { suggested } };
      }
      return { code: 1, text: `product vocab: unknown action '${sub}' (show | init | suggest)`, data: null };
    }
    if (action === 'candidates') {
      const c = productKnowledge.readCandidates();
      const text = c.length
        ? `Candidates awaiting review (${c.length}):\n${c.map(x => `  - ${x.id} [${x.type}] ${String(x.pattern || x.text || '').slice(0, 70)} (src ${x.source_type})`).join('\n')}`
        : 'No candidates awaiting review.';
      return { code: 0, text, data: { candidates: c } };
    }
    if (action === 'gaps') {
      const g = productKnowledge.readGaps();
      const text = g.length
        ? `Knowledge gaps (${g.length}):\n${g.map(x => `  - role=${x.role || '-'} segment=${x.segment || '-'} competitor=${x.competitor || '-'} type=${x.type || '-'}`).join('\n')}`
        : 'No gaps logged.';
      return { code: 0, text, data: { gaps: g } };
    }
    if (action === 'add') {
      const entry = readProductInput(flags);
      if (flags.approvedBy) {
        const res = productKnowledge.addApproved(entry, { approvedBy: flags.approvedBy });
        return res.ok
          ? { code: 0, text: `Added approved entry ${res.entry.id} (by ${res.entry.approved_by}).`, data: res }
          : { code: 1, text: `add failed:\n${res.errors.map(e => `  - ${e}`).join('\n')}`, data: res };
      }
      const vt = productKnowledge.validateVocabTags(entry);
      if (!vt.ok) return { code: 1, text: `add (candidate) failed:\n${vt.errors.map(e => `  - ${e}`).join('\n')}`, data: { ok: false, errors: vt.errors } };
      const stored = productKnowledge.appendCandidate(entry);
      return { code: 0, text: `Added candidate ${stored.id} (approved:false, untrusted:true) — operator-only until promoted.`, data: { candidate: stored } };
    }
    if (action === 'approve') {
      if (!flags.id) return { code: 1, text: 'approve requires --id <candidate-id> and --approved-by "<name>"', data: null };
      const res = productKnowledge.approveCandidate(flags.id, { approvedBy: flags.approvedBy });
      return res.ok
        ? { code: 0, text: `Promoted ${res.entry.id} to approved (by ${res.entry.approved_by}).`, data: res }
        : { code: 1, text: `approve failed:\n${res.errors.map(e => `  - ${e}`).join('\n')}`, data: res };
    }
    if (action === 'mine') {
      if (flags.fromTranscript) {
        // Quarantine guard (v1.9.0, ADR-0019): the Read-matcher quarantine hook
        // cannot see this Bash-invoked CLI read, so refuse a quarantined path
        // here — raw untrusted bytes must go through the transcript-analyzer
        // subagent, whose STRUCTURED output is ingested via --input instead.
        const { isQuarantinedPath, isQuarantineContext } = require('./hooks/attachment-quarantine');
        if (isQuarantinedPath(flags.fromTranscript) && !isQuarantineContext()) {
          return { code: 1, text: `Refused: "${flags.fromTranscript}" is a quarantined path. Route raw transcripts through the transcript-analyzer subagent and ingest its structured output with 'escc product mine --input <json>'.`, data: null };
        }
        const text = fs.readFileSync(flags.fromTranscript, 'utf8');
        const opts = { sourceType: flags.sourceType || 'call', sourceRef: flags.sourceRef || flags.fromTranscript };
        const items = productMine.extractObjectionCandidates(text, opts);
        const stored = productMine.ingestCandidates(items, opts);
        return { code: 0, text: `Mined ${stored.length} candidate(s) from transcript -> operator-only review (all approved:false, untrusted:true).`, data: { candidates: stored } };
      }
      const input = readProductInput(flags);
      const items = Array.isArray(input) ? input : (input.items || []);
      const stored = productMine.ingestCandidates(items, { sourceType: flags.sourceType, sourceRef: flags.sourceRef });
      const dropCap = stored.dropped ? ` (${stored.dropped} over the per-mine cap dropped — raise ESCC_MINE_MAX or ingest in batches)` : '';
      return { code: 0, text: `Ingested ${stored.length} candidate(s) -> operator-only review${dropCap}.`, data: { candidates: stored, dropped: stored.dropped || 0 } };
    }
    return { code: 1, text: `product: unknown action '${action}' (retrieve | resolve-role | vocab | add | approve | candidates | gaps | mine)`, data: null };
  } catch (err) {
    return { code: 1, text: `product ${action} failed: ${err.message}`, data: null };
  }
}

/**
 * Per-account voice overlay verbs (ADR-0015): build/refresh the per-account
 * STYLE register from BUYER text, or print the stored overlay.
 *
 * MCP-free by design (like `product vocab suggest`): the orchestrator gathers
 * the buyer side via the read-only quarantine/thread path and passes it as
 * `--input '{"texts":[...]}'`. Extraction is STYLE-only — the lexicon mirrors
 * the buyer's words, never their claims or numbers (the style/content split,
 * ADR-0013). Facts still come only from approved product-knowledge.
 */
function handleVoice(positional, flags) {
  const action = positional[0] || 'help';
  try {
    if (action === 'account') {
      const account = positional[1];
      if (!account) {
        return { code: 1, text: 'voice account requires <account-id> and --input <json> of buyer texts (e.g. {"texts":[...]}).', data: null };
      }
      let input;
      try {
        input = readProductInput(flags);
      } catch (err) {
        return { code: 1, text: `voice account: could not read JSON input (--input <file> or stdin): ${err.message}`, data: null };
      }
      const texts = Array.isArray(input) ? input : (input.texts || input.buyerTexts || []);
      const register = accountRegister.extractRegister(texts, {});
      const stored = voiceOverlay.overlaySampleCount(account, {});
      const file = voiceOverlay.writeOverlay(account, register, { force: Boolean(flags.force) });
      const kept = stored > 0 && register.sampleCount < stored && !flags.force;
      const text = kept
        ? `Kept the existing higher-confidence overlay for ${account} (${stored} sample(s)); this refresh gathered only ${register.sampleCount} — pass --force to overwrite. Gather the full buyer history to refresh cleanly.`
        : `Wrote per-account voice overlay for ${account} — ${register.sampleCount} sample(s), formality ${register.formality}, ${register.lexicon.length} term(s) -> ${file}.\nSTYLE ONLY: register + buyer lexicon; facts still come from approved product-knowledge.`;
      return { code: 0, text, data: { account, register, file, kept } };
    }
    if (action === 'show') {
      const account = positional[1];
      if (!account) return { code: 1, text: 'voice show requires <account-id>.', data: null };
      const md = voiceOverlay.readOverlay(account, {});
      const text = md || `(no voice overlay for ${account} yet — build one with: escc voice account "${account}" --input <buyer-texts.json>)`;
      return { code: 0, text, data: { account, overlay: md } };
    }
    return { code: 1, text: `voice: unknown action '${action}' (account | show)`, data: null };
  } catch (err) {
    return { code: 1, text: `voice ${action} failed: ${err.message}`, data: null };
  }
}

/**
 * Canonical account-identity verbs (ADR-0018): resolve/link/list the alias
 * index and run the store backfill. Deterministic Node — the HubSpot lookup
 * that DISCOVERS an identity happens in a skill; this records and applies it.
 */
function handleIdentity(positional, flags) {
  const action = positional[0] || 'help';
  try {
    if (action === 'resolve') {
      const raw = positional[1];
      if (!raw) return { code: 1, text: 'identity resolve requires <account-id|name|domain|email>.', data: null };
      const r = accountIdentity.resolveAccountKey(raw);
      if (!r.key) return { code: 1, text: `Could not resolve "${raw}" to a usable key.`, data: r };
      const hint = r.tier === 'name'
        ? `\nLossy name-tier key — link it to the CRM identity: escc identity link "${raw}" company:<hubspot-id>`
        : '';
      return { code: 0, text: `${raw} -> ${r.key} (tier: ${r.tier}${r.via ? `, via alias ${r.via}` : ''})${hint}`, data: r };
    }
    if (action === 'link') {
      const alias = positional[1];
      const canonical = positional[2];
      if (!alias || !canonical) {
        return { code: 1, text: 'identity link requires <alias> <canonical> (e.g. escc identity link "Example Co Pty Ltd" company:<hubspot-id>).', data: null };
      }
      const r = accountIdentity.linkAlias(alias, canonical);
      const warn = r.tier === 'name'
        ? '\nWarning: the canonical side is itself a lossy name-tier key — prefer company:<hubspot-id> or a domain.'
        : '';
      return { code: 0, text: `Linked ${r.alias} -> ${r.canonical}.${warn}\nRun 'escc identity backfill' to merge any existing store fragments.`, data: r };
    }
    if (action === 'list') {
      const rows = accountIdentity.listAliases();
      const text = rows.length
        ? `Alias links (${rows.length}):\n${rows.map(r => `  ${r.alias} -> ${r.canonical}`).join('\n')}`
        : 'No alias links yet. Create one with: escc identity link <alias> <canonical>';
      return { code: 0, text, data: { aliases: rows } };
    }
    if (action === 'backfill') {
      const plan = accountIdentity.backfillPlan();
      if (plan.empty) {
        return { code: 0, text: 'Backfill: nothing to merge — every store already keys canonically.', data: plan };
      }
      const lines = [];
      for (const g of plan.groups) {
        if (g.accountStems.length) lines.push(`  ${g.canonical} <= account fragments: ${g.accountStems.join(', ')}`);
        if (g.voiceStems.length) lines.push(`  ${g.canonical} <= voice overlays: ${g.voiceStems.join(', ')}`);
      }
      if (plan.promiseUpdates.length) {
        lines.push(`  promises re-keyed: ${plan.promiseUpdates.map(u => `${u.id} (${u.from} -> ${u.to})`).join('; ')}`);
      }
      if (!flags.apply) {
        return { code: 0, text: `DRY RUN — identity backfill plan:\n${lines.join('\n')}\nRe-run with --apply to merge (every touched file is backed up first; restore = copy the backups back).`, data: plan };
      }
      const result = accountIdentity.backfillApply(plan);
      return {
        code: 0,
        text: `Merged ${result.mergedAccounts} account fragment(s) and ${result.mergedVoice} voice overlay(s); ${result.promisesUpdated} promise(s) re-keyed.\nBackup (restore = copy back): ${result.backupDir}`,
        data: { plan, result },
      };
    }
    return { code: 1, text: `identity: unknown action '${action}' (resolve | link | list | backfill)`, data: null };
  } catch (err) {
    return { code: 1, text: `identity ${action} failed: ${err.message}`, data: null };
  }
}

/**
 * CRM-to-memory reconcile (ADR-0018): the agent reads live HubSpot state and
 * pipes it in as JSON; this diffs it against account-memory and, with --apply,
 * appends source:'crm-reconcile' events so memory matches CRM. Local-only.
 */
function handleReconcile(positional, flags) {
  let snapshot;
  try {
    snapshot = readProductInput(flags);
  } catch (err) {
    return { code: 1, text: `reconcile: could not read the CRM snapshot JSON (--input <file> or stdin): ${err.message}`, data: null };
  }
  // Batch (morning sweep): {accounts:[{account, deals}], asOf} -> one pass.
  if (Array.isArray(snapshot.accounts)) {
    try {
      const batch = accountReconcile.reconcileBatch(snapshot, { apply: Boolean(flags.apply) });
      return { code: 0, text: accountReconcile.formatBatchReport(batch), data: batch };
    } catch (err) {
      return { code: 1, text: `reconcile (batch) failed: ${err.message}`, data: null };
    }
  }
  const account = positional[0] || snapshot.account || snapshot.account_id;
  if (!account) {
    return { code: 1, text: 'reconcile requires <account> (positional or "account" in the snapshot JSON), or an "accounts" array for a batch.', data: null };
  }
  try {
    const result = accountReconcile.reconcile(account, snapshot, { apply: Boolean(flags.apply) });
    return { code: 0, text: accountReconcile.formatReport(result), data: result };
  } catch (err) {
    return { code: 1, text: `reconcile failed: ${err.message}`, data: null };
  }
}

/**
 * Outcome-ledger verbs (v1.8.0 learning loop): attest, inspect, and summarize
 * the outcomes that move instinct confidence at SessionEnd (I2). `record` is
 * the rep-attestation path for outcomes with no tool call to hook (a prospect
 * REPLY); stage advances and booked meetings capture automatically via
 * post:outcome-capture.
 */
function handleOutcome(positional, flags) {
  const action = positional[0] || 'list';
  const { createStateStoreSync } = require('./lib/state-store');
  try {
    if (action === 'record') {
      if (!flags.type) {
        return { code: 1, text: 'outcome record requires --type <reply_received|meeting_booked|deal_stage_advanced|sequence_step_engaged|closed_won|closed_lost>.', data: null };
      }
      const accountId = flags.account ? accountIdentity.accountKey(String(flags.account)) : null;
      // Dedupe key (v1.9.0 auto-attest): when --thread is supplied, the same
      // inbound reply attested twice (double-triage of one thread) collapses to
      // one row. Thread id is the rep's own mailbox metadata, never prospect
      // prose. Without --thread, behavior is unchanged (always insert).
      const thread = flags.thread ? String(flags.thread) : null;
      const fingerprint = thread
        ? require('crypto').createHash('sha1').update(`${flags.type}:${accountId || ''}:${thread}`).digest('hex')
        : null;
      const store = createStateStoreSync();
      try {
        if (fingerprint) {
          const existing = store.listOutcomes({ type: flags.type, accountId }).find(r => r.fingerprint === fingerprint);
          if (existing) {
            return { code: 0, text: `Already attested ${flags.type}${accountId ? ` for ${accountId}` : ''} (thread ${thread}) — no duplicate row.`, data: existing };
          }
        }
        const payload = {};
        if (flags.note) payload.note = String(flags.note).slice(0, 200);
        if (thread) payload.thread_id = thread;
        const row = store.insertOutcome({
          id: `oc-${Date.now().toString(36)}-${require('crypto').randomBytes(4).toString('hex')}`,
          type: flags.type,
          fingerprint,
          account_id: accountId,
          deal_id: flags.deal ? String(flags.deal) : null,
          session_id: process.env.CLAUDE_SESSION_ID || null,
          payload: Object.keys(payload).length ? payload : null,
        });
        return { code: 0, text: `Recorded outcome ${row.type}${accountId ? ` for ${accountId}` : ''} — the ledger moves instinct confidence at session end.`, data: row };
      } finally {
        store.close();
      }
    }
    if (action === 'void') {
      const id = positional[1] || flags.id;
      if (!id) return { code: 1, text: 'outcome void requires an outcome id (rolls the row back so it stops moving instinct confidence and truth counts).', data: null };
      const store = createStateStoreSync();
      try {
        const row = store.listOutcomes({ includeVoided: true }).find(r => r.id === id);
        if (!row) return { code: 1, text: `No outcome with id ${id}.`, data: null };
        if (row.payload && row.payload.voided) return { code: 0, text: `Outcome ${id} is already voided.`, data: row };
        const voided = store.insertOutcome({ ...row, payload: { ...(row.payload || {}), voided: true } });
        return { code: 0, text: `Voided outcome ${id} (${row.type}) — excluded from the ledger everywhere (distill, truth, summary).`, data: voided };
      } finally {
        store.close();
      }
    }
    if (action === 'list') {
      const store = createStateStoreSync();
      try {
        const accountId = flags.account ? accountIdentity.accountKey(String(flags.account)) : null;
        const rows = store.listOutcomes({ type: flags.type || null, accountId });
        const limit = flags.limit ? Number(flags.limit) : 20;
        const shown = rows.slice(0, Number.isFinite(limit) ? limit : 20);
        const text = shown.length
          ? `Outcomes (${shown.length}/${rows.length}):\n${shown.map(r => `  ${String(r.created_at).slice(0, 10)} ${r.type}${r.account_id ? ` [${r.account_id}]` : ''}${r.deal_id ? ` deal ${r.deal_id}` : ''}`).join('\n')}`
          : 'No outcomes recorded yet — the ledger fills from deal-stage writes, booked meetings, and `escc outcome record`.';
        return { code: 0, text, data: { outcomes: shown, total: rows.length } };
      } finally {
        store.close();
      }
    }
    if (action === 'summary') {
      const sessionSignal = require('./lib/session-signal');
      const store = createStateStoreSync();
      let counts = {};
      try {
        for (const r of store.listOutcomes()) counts[r.type] = (counts[r.type] || 0) + 1;
      } finally {
        store.close();
      }
      const countLines = Object.keys(counts).length
        ? Object.entries(counts).map(([t, n]) => `  ${t}: ${n}`).join('\n')
        : '  (empty — the loop starts compounding once outcomes land)';
      const follow = sessionSignal.formatFollowThrough(sessionSignal.followThroughSummary());
      const text = `Outcome ledger:\n${countLines}${follow ? `\n${follow}` : ''}`;
      return { code: 0, text, data: { counts } };
    }
    return { code: 1, text: `outcome: unknown action '${action}' (record | list | summary)`, data: null };
  } catch (err) {
    return { code: 1, text: `outcome ${action} failed: ${err.message}`, data: null };
  }
}

/** Account truth (ADR-0018): the reconciled, provenance-labeled picture. */
function handleTruth(positional, flags) {
  const account = positional[0];
  if (!account) return { code: 1, text: 'truth requires <account> (name, domain, email, or company:<id>).', data: null };
  let crm = null;
  if (flags.input) {
    try {
      crm = JSON.parse(fs.readFileSync(flags.input, 'utf8'));
    } catch (err) {
      return { code: 1, text: `truth: could not read the CRM snapshot (--input): ${err.message}`, data: null };
    }
  }
  try {
    const t = accountTruth.resolveTruth(account, { crm });
    return { code: 0, text: accountTruth.formatTruth(t), data: t };
  } catch (err) {
    return { code: 1, text: `truth failed: ${err.message}`, data: null };
  }
}

// Known governance event types (a typo'd --event-type filter would otherwise
// silently return an empty result and read as a compliance pass).
const AUDIT_EVENT_TYPES = new Set([
  'outbound_approval', 'outbound_review', 'outbound_send', 'unapproved_send', 'bulk_send_attempt',
  'secret_detected', 'policy_violation', 'approval_requested', 'hook_input_truncated', 'crm_destructive_op',
]);

/**
 * Governance audit (v1.8.0): query/export the outbound decision ledger —
 * "prove we honored this opt-out", "list every override this quarter".
 * Read-only, local-only.
 */
function handleAudit(positional, flags) {
  try {
    const outboundReview = require('./lib/outbound-review');
    const { resolveStateStorePath } = require('./lib/state-store');
    let rows = outboundReview.readGovernanceEvents(resolveStateStorePath());

    if (flags.eventType) {
      if (!AUDIT_EVENT_TYPES.has(flags.eventType)) {
        return { code: 1, text: `audit: unknown --event-type "${flags.eventType}". Known: ${[...AUDIT_EVENT_TYPES].join(', ')}`, data: null };
      }
      rows = rows.filter(r => r.event_type === flags.eventType);
    }
    if (flags.recipient) {
      const needle = String(flags.recipient).toLowerCase();
      rows = rows.filter(r => String((r.payload && r.payload.recipient) || '').toLowerCase().includes(needle));
    }
    if (flags.account) {
      const key = accountIdentity.accountKey(String(flags.account));
      rows = rows.filter(r => r.account_id === key);
    }
    if (flags.since) {
      const since = String(flags.since);
      rows = rows.filter(r => String(r.created_at || '') >= since);
    }
    rows = rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    if (flags.json) {
      return { code: 0, text: JSON.stringify(rows, null, 2), data: { rows } };
    }
    const counts = {};
    for (const r of rows) counts[r.event_type] = (counts[r.event_type] || 0) + 1;
    const head = `Governance audit: ${rows.length} row(s)${Object.keys(counts).length ? ` — ${Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join(', ')}` : ''}`;
    const body = rows.slice(0, 50).map(r => {
      const p = r.payload || {};
      const bits = [String(r.created_at || '').slice(0, 19), r.event_type];
      if (p.recipient) bits.push(p.recipient);
      if (r.account_id) bits.push(`[${r.account_id}]`);
      if (p.override_reason) bits.push(`OVERRIDE: ${p.override_reason}`);
      if (p.decision) bits.push(`decision: ${p.decision}`);
      return `  ${bits.join(' · ')}`;
    }).join('\n');
    return { code: 0, text: rows.length ? `${head}\n${body}${rows.length > 50 ? `\n  … ${rows.length - 50} more (use --json for the full export)` : ''}` : `${head} (no matching rows)`, data: { rows } };
  } catch (err) {
    return { code: 1, text: `audit failed: ${err.message}`, data: null };
  }
}

/**
 * Watch scheduling (v1.8.0 autonomy): emit or install the OS scheduler wiring
 * for the read-only sweep. Emission prints; --install-schedule writes ONE
 * plist file and prints the single load command — nothing registers silently.
 */
function handleWatchSchedule(flags) {
  const scheduleEmit = require('./lib/schedule-emit');
  const intervalSeconds = scheduleEmit.parseIntervalSeconds(flags.interval);
  if (flags.installSchedule) {
    if (process.platform !== 'darwin') {
      return { code: 1, text: `--install-schedule writes a macOS launchd plist; on this platform add the crontab line yourself:\n  ${scheduleEmit.emitCrontabLine({ intervalSeconds })}`, data: null };
    }
    const r = scheduleEmit.installLaunchd({ intervalSeconds });
    return { code: 0, text: `Wrote ${r.plistPath} (every ${intervalSeconds}s).\nActivate it with:\n  ${r.loadCommand}\nRemove later with: launchctl unload ${r.plistPath} && rm ${r.plistPath}`, data: r };
  }
  const text = [
    `Scheduled watch wiring (every ${intervalSeconds}s):`,
    '',
    '# macOS — save as ~/Library/LaunchAgents/com.escc.watch.plist, then `launchctl load -w <path>`',
    scheduleEmit.emitLaunchdPlist({ intervalSeconds }),
    '# Linux/other — add to `crontab -e`:',
    scheduleEmit.emitCrontabLine({ intervalSeconds }),
  ].join('\n');
  return { code: 0, text, data: { intervalSeconds } };
}

/**
 * Notify-queue drain (v1.8.0 autonomy): print queued escalations for delivery.
 * --approve-self <your-email> additionally mints a SELF-DIGEST approval token
 * (recipient = the operator's own mailbox, content = exactly the digest body
 * printed) so the fail-closed send-gate admits the matching Gmail draft. The
 * gate itself is untouched — this is a blessed token for a self-addressed
 * digest, unusable for any other recipient or content.
 */
function handleNotify(positional, flags) {
  const action = positional[0] || 'drain';
  if (action !== 'drain') {
    return { code: 1, text: `notify: unknown action '${action}' (drain)`, data: null };
  }
  try {
    const notifyLib = require('./lib/notify');
    const records = notifyLib.drainNotifications({ clear: Boolean(flags.clear) });
    if (!records.length) {
      return { code: 0, text: 'Notify queue: empty.', data: { records: [] } };
    }
    const subject = `ESCC digest — ${records.length} queued notification(s)`;
    const body = records
      .map(r => `- [${r.severity || 'medium'}] ${r.message || r.title || '(no message)'}${r.account ? ` (${r.account})` : ''}`)
      .join('\n');
    const lines = [`Notify queue (${records.length})${flags.clear ? ' — CLEARED after read' : ''}:`, body];

    if (flags.approveSelf) {
      const email = String(flags.approveSelf).trim();
      if (!/@/.test(email)) return { code: 1, text: `--approve-self requires your own email address (got "${email}").`, data: null };
      const key = require('./lib/outbound-review').outboundContentKey({ recipient: email, subject, body });
      require('./lib/outbound-review').recordApproval({
        key,
        recipient: email,
        accountId: accountIdentity.accountKey(email),
        confidence: 1,
        verdict: 'approved',
        gates: { self_digest: 'pass' },
        approver: process.env.ESCC_REP_IDENTITY || email,
        approverRole: process.env.ESCC_ROLE || process.env.ESCC_REP_ROLE || 'rep',
      });
      lines.push('', `Self-digest approval token minted for ${email}. Create the Gmail draft with EXACTLY:`, `  subject: ${subject}`, '  body:', body.split('\n').map(l => `    ${l}`).join('\n'));
    }
    return { code: 0, text: lines.join('\n'), data: { records, subject, body } };
  } catch (err) {
    return { code: 1, text: `notify drain failed: ${err.message}`, data: null };
  }
}

// --- dispatch ---------------------------------------------------------------

/** Route an argv vector to a handler. @returns {{code:number, text:string, data:*}} */
function run(argv = []) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') return handleHelp();

  // Instinct mounts: forward the raw tail so instinct-cli's own flag parser applies.
  if (command === 'instinct-status') return instinctCli.run(['status', ...rest]);
  if (command === 'instinct-promote') return instinctCli.run(['promote', ...rest]);
  if (command === 'evolve') return instinctCli.run(['evolve', ...rest]);

  const { flags, positional, errors } = parseArgs(rest);
  if (errors.length) return { code: 1, text: `${errors.join('; ')}. Run 'escc help' for usage.`, data: null };
  switch (command) {
    case 'install': return installer.runInstall(toInstallOpts(flags));
    case 'plan': return installer.runPlan(toInstallOpts(flags));
    case 'catalog': return handleCatalog(flags);
    case 'doctor': return handleDoctor(flags);
    case 'repair': return handleRepair(flags);
    case 'status': return handleStatus(flags);
    case 'sessions': return handleSessions(flags);
    case 'list-installed': return handleListInstalled(flags);
    case 'uninstall': return handleUninstall(flags);
    case 'auto-update': return autoUpdateLib.runAutoUpdate({ repoRoot: flags.repoRoot, homeDir: flags.home, targets: flags.target ? [flags.target] : undefined, dryRun: flags.dryRun });
    case 'privacy-purge': return purgeLib.runPurge({ identifier: positional[0], confirm: flags.confirm });
    case 'watch':
      if (flags.emitSchedule || flags.installSchedule) return handleWatchSchedule(flags);
      return watchLib.runWatch({ withinDays: flags.withinDays ? Number(flags.withinDays) : undefined });
    case 'notify': return handleNotify(positional, flags);
    case 'outbound': return handleOutbound(positional, flags);
    case 'product': return handleProduct(positional, flags);
    case 'voice': return handleVoice(positional, flags);
    case 'identity': return handleIdentity(positional, flags);
    case 'reconcile': return handleReconcile(positional, flags);
    case 'worklist': return require('./lib/worklist-store').runWorklist(positional, flags);
    case 'twin': return require('./lib/twin-digest').runTwin(flags);
    case 'outcome': return handleOutcome(positional, flags);
    case 'truth': return handleTruth(positional, flags);
    case 'audit': return handleAudit(positional, flags);
    default: return { code: 1, text: `Unknown command: ${command}. Run 'escc help' for usage.`, data: null };
  }
}

module.exports = { run, parseArgs, camel, idsOf, HELP };

if (require.main === module) {
  const res = run(process.argv.slice(2));
  if (res && typeof res.text === 'string' && res.text) process.stdout.write(`${res.text}\n`);
  process.exit(res ? res.code : 0);
}
