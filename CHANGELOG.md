# Changelog

All notable changes to EverythingSales Claude Code (ESCC) are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ESCC is adapted from [Everything Claude Code](https://github.com/affaan-m/ECC)
(ECC) by Affaan Mustafa, under the MIT License. The harness machinery is ported
with attribution; all engineering content is replaced with sales content.

## [0.1.0] - 2026-06-17

Initial release — the first complete build of the ESCC plugin harness. ESCC
turns Claude Code into a sales co-pilot for SDRs, AEs, Sales Managers, and
RevOps, grounded in HubSpot, MEDDPICC, and compliant outbound. It is built on
ECC's architecture: skills-first content, profile-gated hooks, instinct-based
continuous learning, session/context persistence, manifest-driven persona
installs, and a CI-enforced quality pipeline.

### Added

#### Machinery (Node >= 18, plain CommonJS, sole dependency `ajv`)

- **Hook runtime** — `hooks/hooks.json` (schema-validated against
  `schemas/hooks.schema.json`) wiring hooks through a dispatch runner
  (`run-with-flags.js`) via `${CLAUDE_PLUGIN_ROOT}`, with profile gating
  (`ESCC_HOOK_PROFILE` = minimal | standard | strict) and per-hook disable
  (`ESCC_DISABLED_HOOKS`). Every hook fails open **except**
  `pre:outbound-send-gate`, which fails closed.
- **Outbound send-gate** — `pre:outbound-send-gate` blocks any live send by a
  send-capable tool until a review-evidence marker (an `outbound-reviewer` run)
  is recorded; bulk sends capped by `ESCC_BULK_SEND_MAX` (default 5). Gmail is
  draft-only by construction.
- **CRM and content guards** — `pre:crm-write-guard` (deletes,
  stage-advance/next-step checks), `pre:compliance-protection` (blocks agent
  edits to compliance-bearing files), `pre:attachment-quarantine` (routes
  prospect files to a restricted subagent), and a slim `pre:bash` dispatcher.
- **Session and context persistence** — `session:start` priority-budgeted
  context injection (capped by `ESCC_SESSION_START_MAX_CHARS`), `session:end`
  summary + account-memory append + first-class promise records, `pre:compact`
  resumable scratch state, and a per-entity account-memory store that holds
  context across many sessions.
- **Instinct engine (Node rewrite)** — observe -> distill -> promote with
  confidence scoring weighted by real outcomes, a decay model, manager-gated
  promotion, an `/evolve` graduation threshold, and an actionable
  `/instinct-status` review gate. Instincts never form from untrusted
  (prospect-supplied) content.
- **Statusline + metrics bridge** — `escc-statusline.js` renders model, task,
  cost/turn counters, persona/workspace, and a context-utilization meter, fed
  by a per-session metrics bridge file.
- **JSONL state store** — append-oriented JSONL tables (sessions, skillRuns,
  decisions, installState, governanceEvents, work items, plus promises,
  forecast snapshots, and outcomes), a rewrite of ECC's SQL store behind the
  same exported function signatures.
- **Operator CLI** — `scripts/escc.js` with 12 subcommands: install, plan,
  catalog, doctor, repair, status, sessions, list-installed, uninstall,
  auto-update, privacy-purge, watch; mounts the instinct commands. Includes
  `escc privacy-purge` (GDPR-style local erasure, dry-run by default) and
  `escc watch` (scheduled read-only trigger sweep -> notification delivery).
- **Installer + manifests** — plan-then-apply, idempotent installer
  (`scripts/install.js`) over `manifests/install-profiles.json`,
  `install-modules.json`, and `install-components.json` (persona / capability /
  methodology families, plus synthetic per-skill components). Install profiles:
  sdr, ae, sales-manager, revops, full.
- **Notification delivery** — `notify.js` routes severity-tagged events to
  Slack / Gmail-draft-to-self / desktop fallback.

#### Content

- **64 skills** (`skills/<name>/SKILL.md`) across SDR, AE, Manager/RevOps,
  cross-persona/foundational, and meta groups — the canonical workflow surface.
- **18 agents** (`agents/<name>.md`), least-privilege and read-only by default,
  each opening with the prompt-defense baseline. `crm-operator` is the sole
  write-capable agent.
- **66 commands** (`commands/<name>.md`) — thin shims (<= 20 non-frontmatter
  lines) that delegate to a skill.
- **23 rules** (`rules/`) — layered: `common/` base, `meddpicc/` and
  `segments/` overlays, plus operational rules and `jurisdictions/` overlays.
  Outbound is compliant by construction (AU Spam Act 2003 first-class, plus
  CAN-SPAM and GDPR/PECR).
- **Contexts, seed instincts, and MCP config templates** — persona contexts
  (`contexts/`), shipped seed instincts, and placeholder-keyed
  `mcp-configs/mcp-servers.json` (HubSpot system of record; Gmail + Google
  Calendar; Fireflies transcripts).

#### Quality plane

- **CI validators** (`scripts/ci/`) — validate-skills, validate-agents,
  validate-commands, validate-rules, validate-hooks, validate-manifests,
  check-unicode-safety, and validate-no-personal-paths, with progressive
  strictness (pre-existing issues warn; new issues error under `CI_STRICT`).
- **Content-guard tests** — outbound-reviewer confidence gate
  (report only >80%-confident findings; "a clean review is a valid review"),
  outbound-compliance presence (consent / sender identity / opt-out across
  AU / US / EU), and agent-instruction-safety (read-only defaults,
  `crm-operator` as sole writer, approval language).
- **Catalog and command-registry pinning** — `catalog.js` pins the surface
  counts into the README; `generate-command-registry.js` emits a deterministic
  command registry. Run `npm test` to execute the full gate.
- **GitHub Actions CI** — validators + tests on macOS and Ubuntu across
  Node 18 / 20 / 22, with a PR template, CODEOWNERS, and dependabot.

### Notes

- Licensed under the MIT License, Copyright (c) 2026 Lucas. Adapted from ECC
  (MIT) by Affaan Mustafa; ported files carry an attribution header pointing
  back to ECC.
- Status: v0.1.0, in active build. Surfaces and counts are CI-pinned; expect
  rapid iteration.

[0.1.0]: https://github.com/aura-farming/escc/releases/tag/v0.1.0
