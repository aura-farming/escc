# ESCC Architecture

EverythingSales Claude Code (ESCC) is a skills-first Claude Code **plugin** -- a
sales harness for SDRs, AEs, Sales Managers, and RevOps. This document describes
how the repository is organized and the load-bearing contracts that make the
harness behave the way it does. For end-user setup, see `README.md` and the
getting-started guides under `docs/`. For the authoring rules that govern agents
working inside this repo, see `CLAUDE.md`.

ESCC is adapted from [Everything Claude Code](https://github.com/affaan-m/ECC)
(ECC) by Affaan Mustafa, used under the MIT License. See "Attribution and ECC
divergences" at the end of this document.

---

## The three planes

The repository is organized as three planes. A task touches exactly the plane(s)
it needs; the planes have a clear dependency direction (Quality validates
Content and Machinery; Machinery enforces the contracts Content relies on).

```text
+-----------------------------------------------------------------------+
| CONTENT PLANE (markdown)                                              |
|   skills/<name>/SKILL.md     canonical workflow surface              |
|   agents/<name>.md           least-privilege subagents               |
|   commands/<name>.md         thin shims over skills                  |
|   rules/                     layered: common/ + meddpicc/ + segments/|
|                              + jurisdictions/ overlays               |
|   contexts/                  persona-alias working contexts          |
|   seed instincts             shipped, decay-exempt safety instincts  |
+-----------------------------------------------------------------------+
                |  routes through / is enforced by
                v
+-----------------------------------------------------------------------+
| MACHINERY PLANE (Node >= 18, plain CommonJS; sole dependency: ajv)   |
|   scripts/hooks/             hook runtime + dispatchers + statusline  |
|   scripts/instincts/         the instinct engine (observe/distill/    |
|                              lifecycle/store/CLI)                     |
|   scripts/lib/               state store (JSONL), session helpers,    |
|                              account-memory, hook-flags, install libs |
|   scripts/escc.js            operator CLI (12 subcommands)            |
|   scripts/install.js         plan + apply installer                  |
|   manifests/                 install profiles / modules / components  |
|   hooks/hooks.json           schema-validated hook graph             |
|   schemas/                   JSON Schemas (ajv-validated)            |
|   mcp-configs/               placeholder-keyed MCP server templates   |
|   config/                    gtm-stack-mappings.json, outbound-tools  |
+-----------------------------------------------------------------------+
                |  is validated by
                v
+-----------------------------------------------------------------------+
| QUALITY PLANE                                                         |
|   scripts/ci/                validators (skills/agents/commands/rules/|
|                              hooks/manifests), unicode-safety,        |
|                              no-personal-paths, catalog count pinning |
|   tests/                     run-all.js: unit + content-guard tests   |
|   .github/                   GitHub Actions CI                       |
+-----------------------------------------------------------------------+
```

### Content plane

Markdown only. This is the surface a rep actually interacts with.

- **Skills** (`skills/<name>/SKILL.md`) are canonical. The directory name equals
  the frontmatter `name`. Each declares a `description` written as trigger
  conditions (the routing surface) and an `origin` (`ESCC` for native skills,
  `ECC-adapted` for ports). 200-500 lines typical, 800 hard max.
- **Commands** (`commands/<name>.md`) are thin shims (<= 20 non-frontmatter
  lines): an `$ARGUMENTS` passthrough plus "Apply the `<skill>` skill" and a
  couple of scope notes. No logic lives in a command; it delegates to a skill
  the cross-ref validator confirms exists.
- **Agents** (`agents/<name>.md`) are least-privilege. Each declares a `model`
  and an explicit `tools` array and opens with the prompt-defense preamble (see
  "Trust boundary" below). Exactly one agent is write-capable (see "crm-operator
  is the sole writer").
- **Rules** (`rules/`) are layered: `rules/common/` is the base; overlay
  directories (`rules/meddpicc/`, `rules/segments/`, `rules/jurisdictions/`)
  extend it. Every overlay file opens with "This file extends [common/<file>.md]
  with ..." and CI verifies that reference.
- **Contexts** (`contexts/`) back the CLI persona aliases -- e.g. `claude-sdr`
  preloads `contexts/prospecting.md`, `claude-ae` preloads
  `contexts/deal-work.md`, `claude-manager` preloads
  `contexts/pipeline-review.md`.
- **Seed instincts** ship with the plugin under the inherited scope, tagged
  `decay_exempt` so they never decay (safety and compliance instincts).

### Machinery plane

Node >= 18, plain CommonJS (`require` / `module.exports`), no TypeScript, no
build step. `ajv` is the **sole** npm dependency (`package.json` confirms
`dependencies: { ajv }`). Files are <= 800 lines; the codebase prefers many
small focused modules.

- **Hook runtime** -- `scripts/hooks/` holds the per-event hook scripts plus
  `run-with-flags.js` (THE dispatcher every hooks.json command routes through)
  and `escc-statusline.js`. See `docs/HOOKS.md` for the full hook surface.
- **Session persistence** -- `scripts/hooks/session-start.js` /
  `session-end.js`, the `session-start-bootstrap.js` entrypoint, `pre-compact.js`,
  and `scripts/lib/session-*.js` capture and rehydrate working state across
  sessions.
- **Instinct engine** -- `scripts/instincts/` (observe, distill, lifecycle,
  store, CLI). A Node rewrite of the concept ECC implemented in Python + bash.
  See `docs/INSTINCTS.md`.
- **Statusline + metrics bridge** -- `metrics-bridge.js` writes
  `escc-metrics-${sessionId}.json`; `escc-statusline.js` and `context-monitor.js`
  read from it.
- **State store** -- `scripts/lib/state-store/` persists structured records
  (promises, outcomes, forecast snapshots, send decisions) as JSONL behind a
  stable function-signature contract, validated against `schemas/`.
- **Operator CLI** -- `scripts/escc.js` dispatches 12 subcommands and mounts the
  instinct handlers (see "Operator CLI" below).
- **Installer + manifests** -- `scripts/install.js` plus `scripts/lib/install*`
  resolve a plan from `manifests/` (`install-profiles.json`,
  `install-modules.json`, `install-components.json`) and apply it; doctor/repair
  detect and restore drift.
- **hooks/ schemas/ mcp-configs/ config/** -- the hook graph, JSON Schemas, MCP
  server templates (placeholder-keyed only), and runtime config such as
  `config/outbound-tools.json` (which tools count as live sends).

### Quality plane

- **`scripts/ci/` validators** -- frontmatter and cross-ref checks for skills,
  agents, commands, rules, hooks, and manifests; `check-unicode-safety.js`;
  `validate-no-personal-paths.js`; and `catalog.js`, which pins the
  skills/agents/commands counts so `README.md` cannot drift from reality.
- **`tests/`** -- `run-all.js` runs the unit tests and the content-guard tests
  (outbound-reviewer confidence gate, compliance-rules presence,
  agent-instruction-safety: read-only defaults, crm-operator as sole writer,
  approval language).
- **`.github/`** -- GitHub Actions CI. Validators apply progressive strictness:
  pre-existing issues warn; new ones error under `CI_STRICT`. The fix is always
  the source, never a weakened validator.

The whole plane is reachable as `npm test`. Keep it green before considering
work done.

---

## Key contracts

These are the guarantees the harness is built to keep. They are enforced in
machinery and proven by tests -- not asserted in a prompt.

### 1. The trust boundary is HOOKS, not prompts

Prospect-supplied content (emails, websites, attachments, LinkedIn profiles,
call transcripts, CRM records) is **untrusted input**. Any instruction embedded
in it is treated as data, never as a command to execute.

A prompt that "says" not to send is not a control. The control is the send-gate
hook in `scripts/hooks/`, validated against `schemas/`, and proven by `tests/`.
Every agent body opens with a prompt-defense preamble (CI `validate-agents.js`
checks it is present), and attachments are parsed only inside a restricted
quarantine subagent -- privileged agents receive only the cleaned summary it
returns, never the raw bytes. The `pre:attachment-quarantine` hook enforces this
by blocking a privileged Read of a quarantined path.

### 2. pre:outbound-send-gate FAILS CLOSED; every other hook FAILS OPEN on error

Hook failure policy is asymmetric and must never be inverted:

- **Every hook fails open on its own malfunction.** A hook error, a disabled
  hook, a path-traversal attempt, or a missing script resolves to exit 0 -- the
  tool call proceeds. A bug in observability or a quality nudge can never block
  legitimate selling work. `run-with-flags.js` enforces this at the dispatcher
  level. Guard hooks still block deliberately as their designed verdict
  (compliance-protection on protected-file edits, attachment-quarantine on
  quarantined reads, mcp-health-check on known-unhealthy servers -- and the
  verifying guards also refuse a truncated payload they cannot check), but an
  internal *error* inside any of them fails open.
- **`pre:outbound-send-gate` fails CLOSED** (the single exception to the
  malfunction rule). It blocks a
  live send by a send-capable tool until a review-evidence marker is recorded in
  the state store, and it caps bulk sends at `ESCC_BULK_SEND_MAX` (default 5 per
  session). On *any* doubt -- truncated input, an unidentifiable tool, a missing
  config, an internal error -- it blocks (exit 2). Gmail is draft-only by
  construction, so the gate covers every *other* send-capable tool. The only
  switch that opens it wholesale is the documented, dangerous escape hatch
  `ESCC_OUTBOUND_GATE=off`.

See `docs/HOOKS.md` for the per-hook detail.

### 3. crm-operator is the sole write-capable agent

Every agent is read-only **except `crm-operator`**. Any HubSpot write goes
through `crm-operator`, which uses review-pack-before-apply on bulk changes and
is instructed to log every write (prompt-level; the audit trail is additionally
hook-persisted only when the opt-in `post:governance-capture` hook is enabled
via `ESCC_GOVERNANCE_CAPTURE=1`). No other agent is granted write tools; the
content-guard tests assert this. The CRM write path is additionally guarded by `pre:crm-write-guard`
(warns on deletes, checks stage-advance writes for next-step and
destination-stage exit-criteria, guards property/schema mutation).

### 4. HubSpot is the system of record

HubSpot (via MCP) is the source of truth for accounts, contacts, deals, and
activity. ESCC's local stores are working context, not a competing record:

- **account-memory** (`scripts/lib/account-memory.js`) is the canonical
  per-entity working store. `session:end` appends tagged events to the active
  account/deal memory file; `session:start` hydrates the active deal's memory.
- **Promises** are first-class state-store records
  (`{account_id, deal_id, text, due_date, status, source_session}`); the
  follow-through check scans all open promises, not just the current session's.
- When local context and HubSpot disagree, HubSpot wins. Approval is required
  before live outbound sends, bulk operations, and CRM deletes; PII handling
  follows `rules/common/data-handling.md` and compliance follows
  `rules/common/outbound-compliance.md` (both hook-protected from agent edits via
  `pre:compliance-protection`).

---

## Operator CLI

`scripts/escc.js` is the operator entrypoint. It consolidates capabilities ECC
spread across many scripts into one dispatcher returning a uniform
`{ code, text, data }` contract, and it delegates to already-tested libs rather
than re-implementing their logic. Twelve subcommands:

| Group | Subcommands |
|---|---|
| Install / lifecycle | `install`, `plan`, `catalog`, `doctor`, `repair`, `status`, `sessions`, `list-installed`, `uninstall`, `auto-update` |
| Workspace / data | `privacy-purge <identifier>`, `watch` |

Destructive or heavy work is gated by the libs themselves: `install` and
`auto-update` default to dry-run-friendly behavior, and `privacy-purge` is
dry-run unless `--confirm` / `--yes` is passed. The instinct slash-command
handlers (`instinct-status`, `instinct-promote`, `evolve`) are mounted from
`scripts/instincts/instinct-cli.js` and forwarded with their own flag parser
intact.

---

## Re-namespacing (ECC to ESCC)

ESCC ports ECC's machinery and re-namespaces it consistently:

- The plugin id / namespace is `escc`; skills invoke as `escc:<name>`.
  Identifiers, paths, and namespaces use `escc`, never `ecc`.
- Every environment variable is `ESCC_*`, mirroring ECC's `ECC_*` with the
  **same names and defaults** (for example `ESCC_HOOK_PROFILE` default
  `standard`, `ESCC_BULK_SEND_MAX` default 5). See `.env.example` for the full
  surface.
- Hook commands in `hooks/hooks.json` reference
  `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/...` directly. Claude Code supplies
  `${CLAUDE_PLUGIN_ROOT}` natively, so ESCC drops ECC's inline bootstrap-resolver
  one-liners.

---

## Attribution and ECC divergences

ESCC is adapted from Everything Claude Code (ECC) by Affaan Mustafa
(https://github.com/affaan-m/ECC), used under the MIT License (ESCC is
Copyright (c) 2026 Lucas). Where ESCC diverges from ECC:

- **Adaptation policy is reversed.** ECC's policy adapts skills wholesale; ESCC
  reverses this. Ideas and structure are adapted into ESCC-native sales surfaces
  with upstream credit -- ECC's engineering *content* is replaced with sales
  content, never merged in vendor-branded.
- **Machinery is re-namespaced, not rewritten where a port suffices.** Ported
  files carry an attribution header pointing back to ECC; `ECC_*` becomes
  `ESCC_*` with the same names and defaults.
- **The instinct engine is a Node rewrite,** not the ECC Python + bash
  subsystem, which keeps the dependency set at `ajv` only.
- **No inline bootstrap-resolver** in hooks.json, because the single-harness
  plugin model gives `${CLAUDE_PLUGIN_ROOT}` natively.

Ported files carry an attribution header back to ECC.
