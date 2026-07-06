# Changelog

All notable changes to EverythingSales Claude Code (ESCC) are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ESCC is adapted from [Everything Claude Code](https://github.com/affaan-m/ECC)
(ECC) by Affaan Mustafa, under the MIT License. The harness machinery is ported
with attribution; all engineering content is replaced with sales content.

## [1.6.0] - 2026-07-06

The agentic routing core: ESCC now **auto-invokes reliably instead of waiting
for slash commands**. The fix is architectural (see
[ADR-0016](docs/DECISIONS.md)): the skill-description routing surface is
compressed to fit the harness's context budget (so every skill is visible to
auto-invocation again), a deterministic **intent-router** hook suggests the
right skill at prompt time even when descriptions are truncated, a
**chaining-hints** hook proposes the next play after a high-signal tool result,
and session start teaches `/daily`. See
[docs/releases/v1.6.0.md](docs/releases/v1.6.0.md).

### Added

- **`prompt:intent-router` (UserPromptSubmit hook).** Keyword-matches the
  user's prompt against `config/skill-keywords.json` — a priority-ordered
  routing table (~60 routes: compliance first, specific before general, one
  entry per collision-cluster winner) — and injects ONE one-line
  `escc:<skill>` hint. Budget-independent: it routes even where a skill's
  description was dropped from context. Skips slash commands, explicit
  `escc:<skill>` mentions, and short prompts; pure hint; fails open.
- **`post:chaining-hints` (PostToolUse hook).** After a high-signal tool
  result, proposes the chained next play from
  `config/tool-skill-chains.json`: a Fireflies transcript → `discovery-notes`
  (or `call-review`), a Gmail thread read → `reply-handling` (or
  `inbox-triage`), a HubSpot **deal** read → `deal-review` (an `input_match`
  filter keeps contact/company reads silent). Each chain family fires at most
  once per session; errored calls are skipped; pure hint; fails open.
- **Session-start `/daily` nudge.** On a true startup (never resume/clear/
  compact), one line teaching the morning brief — lowest-priority block, first
  dropped under the context budget.
- **Routing-budget CI pin** in `validate-skills.js`: any description over 220
  chars, or a total routing surface over 14,000 chars, fails the build — the
  overflow that silently disabled auto-invocation can never regress.

### Changed

- **All 66 skill descriptions compressed** from 39,193 to 12,645 chars
  (avg 594 → 192) into trigger-style lines, resolving the five
  trigger-collision clusters (forecast, follow-up, call, pipeline, deal) with
  unique phrase ownership per skill. No content lost: every detail remains in
  each skill's "When to Activate" body section.
- Catalog: **28 hook matchers** (was 26; CI-pinned). `docs/HOOKS.md` documents
  both new hooks; `run-with-flags.js` maps the `prompt:` hookId prefix to
  UserPromptSubmit.

### Fixed

- **Date-bomb in `outbound-approve.test.js`:** the clean-draft case approved
  with a pinned past date, so its 7-day approval token expired on 2026-06-30
  and the (correctly behaving) fail-closed send-gate began blocking it. The
  test now approves at the real current time; the machinery was never wrong.

### Security

- Both new hooks are **pure hints**: they inject one suggestion line, never
  block, never rewrite a prompt or a tool result, and fail OPEN on any internal
  error. The fail-closed send-gate, the CRM write guard, and every other
  enforcement surface are untouched. Routing tables are data
  (`config/*.json`), not code, and CI verifies every route points at a real
  skill.

## [1.5.0] - 2026-06-25

Per-account / per-KDM tone-match: a new deterministic **per-account voice
overlay** layers on the rep's base `[VOICE PROFILE]` so a draft to an account
mirrors how *that* account writes — their register and recurring vocabulary —
while every fact still comes only from approved product-knowledge. It is
**STYLE only by construction**: the mirrored lexicon borrows the buyer's words,
never their claims or numbers. See [ADR-0015](docs/DECISIONS.md) and
[docs/releases/v1.5.0.md](docs/releases/v1.5.0.md).

### Added

- **`escc voice account|show` operator verb** plus two no-dependency libs:
  `scripts/lib/account-register.js` (deterministic, no-ML register: formality,
  average sentence length, question rate, greeting/sign-off, and the buyer's
  top recurring **alphabetic** terms) and `scripts/lib/voice-overlay.js` (the
  per-account overlay at `.claude/escc/voice/account/<account>.md` — gitignored,
  atomic write). `voice account` builds/refreshes the overlay from buyer texts
  passed via `--input` (MCP-free; the orchestrator gathers the buyer side
  through the read-only quarantine/thread path); `voice show` prints it.
- **brand-voice "Per-Account Voice Overlay" section.** Documents the layering
  (rep base voice × buyer-role register × this-account register × mirrored
  lexicon), the storage path, and the buyer-side-only / quarantine rule. The
  base profile still wins on the rep's Banned/Preferred Moves.
- **Content guard `content-guard-lexicon-leak`.** Pins from the threat side that
  a planted buyer claim/number never reaches the rendered overlay, that no
  lexicon term ever carries a digit, that a source sentence is never echoed, and
  that brand-voice still states the split rule + the overlay path in prose.

### Changed

- Version metadata reconciled to **1.5.0** across `package.json`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CLAUDE.md`,
  `SOUL.md`, `AGENTS.md`, and `agent.yaml` (the last three were stale from
  earlier releases).
- Catalog is **unchanged** (66 skills, 18 agents, 68 commands): Phase C adds
  machinery and one operator CLI verb, no new skill / agent / command.

### Security

- The style/content split (ADR-0013) is **enforced at write time, not by a
  prompt**. The per-account lexicon mirrors the buyer's **words** only — a
  metric, percentage, or currency figure can never become a term (a token
  survives only if it is pure-alphabetic with no digit), and no source sentence
  is echoed into the overlay. Facts and metrics stay sourced **only** from
  approved `product-knowledge`. The `escc voice` CLI is MCP-free, and buyer text
  reaches it only through the read-only quarantine/thread path.

## [1.4.0] - 2026-06-25

Drag-and-drop knowledge intake: a new **`/ingest`** wizard routes an existing
file — sent emails, a call transcript, a case study, a pricing or security
one-pager, a competitor doc, or an ICP/industries list — into the right ESCC
layer, on the clean base v1.3.0 established. It adds **no new machinery**: every
leg reuses an existing surface, the candidate/approved firewall and the
fail-closed send-gate are untouched, and untrusted content is read only by a
read-only quarantine subagent. See [ADR-0014](docs/DECISIONS.md).

### Added

- **`/ingest` (knowledge-intake skill).** An AskUserQuestion intake wizard
  (classify → dry-run → quarantine-extract → route → one review summary)
  mirroring `configure-escc`. Routing: your sent emails / brand doc → the
  brand-voice VOICE PROFILE (style, auto-apply); a call transcript →
  `transcript-analyzer` (quarantine) → `discovery-notes` (CRM proposal +
  MEDDPICC) plus objection/pain candidates via `escc product mine --input`; a
  case study / pricing / security doc / stated claim → `escc product add`
  candidate; a competitor doc → a `battlecard` candidate (via
  `competitor-analyst`) plus a competitor-vocab suggestion; an ICP / industries
  list → `escc product vocab suggest`. Installed with the cross-cutting skills.
- **Content guard `content-guard-knowledge-intake`.** Pins the `/ingest`
  invariants from the test side: untrusted content is quarantined to a read-only
  subagent, every product claim enters as a candidate promoted only by `escc
  product approve`, ingest uses `mine --input` and refuses the
  quarantine-bypassing `--from-transcript`, and the skill is never pointed at
  the candidate store.

### Changed

- Catalog: **66 skills, 68 commands** (CI-pinned); command registry regenerated.

### Security

- The candidate/approved firewall (ADR-0012) and the style/content split
  (ADR-0013) are unchanged: only **STYLE** (voice) and account **CONTEXT**
  auto-apply; every product **CLAIM** is operator-reviewed before it is quotable.
  `/ingest` never uses `escc product mine --from-transcript` (which reads raw
  bytes in the CLI and bypasses the quarantine hook) — it extracts via a
  read-only subagent and ingests the structured result with `--input`.

## [1.3.0] - 2026-06-25

Open-source readiness: ESCC is now **company-neutral by construction**, so any
sales team can install it and keep their own data in their gitignored workspace.
The controlled vocabulary ships as a generic cross-industry template with a new
per-workspace override, and two CI guards make a brand name or a credential
impossible to commit. See [ADR-0013](docs/DECISIONS.md).

### Added

- **Per-workspace vocabulary override.** `loadVocab` gains a workspace tier
  (`<data-home>/escc/product/knowledge-vocab.json`) between an explicit path and
  the shipped template, plus `escc product vocab show | init | suggest` to inspect,
  seed, and grow it from CRM industry values. New `product-knowledge` functions
  `vocabSource`, `workspaceVocabPath`, `readVocabFile`, `slugifySegment`,
  `suggestSegments`, `initWorkspaceVocab`, `addSegmentsToWorkspace`; optional
  `note` field on `schemas/knowledge-vocab.schema.json`.
- **CI guards.** `validate-no-company-tokens.js` (banned-brand list in
  `config/banned-company-tokens.json`, word-boundary matched, git-tracked-only)
  and `validate-no-secrets.js` (high-confidence credential signatures) join the
  `npm test` pipeline.

### Changed

- **Company-neutral defaults.** `config/knowledge-vocab.json` ships as a generic
  cross-industry template (`competitors: []`, `segments: ["general"]`,
  cross-industry roles + title map); all committed example / seed / test data is
  genericized (`Acme` / `competitor-x` / `Example Operator`). Legitimate
  authorship (the MIT `LICENSE` / `plugin.json` author) is unchanged.
- `.gitignore` now also excludes runtime `voice/`, `patterns/`, and
  learned/pending instinct stores.

### Security

- No credential was ever committed (working tree or git history); history is left
  intact and scrubbed going forward (ADR-0013). The new validators prevent any
  brand-name or credential regression.

## [1.2.0] - 2026-06-25

Persona/role-keyed product-knowledge layer. Drafting can now write to a contact's
**role** and **stack**, not just industry — with the fabrication firewall made
structurally stronger. Additive and backward compatible: every new field is
optional, so existing entries and drafting flows are unchanged. See
[ADR-0012](docs/DECISIONS.md) and
[RELEASE_NOTES_v1.2.0.md](RELEASE_NOTES_v1.2.0.md).

### Added

- **Persona/role-keyed knowledge.** New optional `product-knowledge` type values
  `objection` / `pain` / `battlecard` and tags `role` / `competitor` alongside
  `segment`, pinned by the first product-store JSON Schema
  (`schemas/product-knowledge.schema.json`). A reserved `resonance` field is
  human-write-only and unwired (the auto-inferred resonance signal and the
  ongoing outcome-fed loop are deferred).
- **Controlled vocabulary** (`config/knowledge-vocab.json` + its schema): closed
  role / segment (industry) / competitor sets and a HubSpot `jobtitle`->role map
  with a `general` fallback, validated by a disk-loading test.
- **Coded retrieval ladder** (`scripts/lib/product-knowledge.js`):
  role+segment+competitor -> role+segment -> segment -> general, approved-and-fresh
  only (battlecard/pain decay faster), with an explicit "no approved proof"
  sentinel and gap logging; never throws.
- **Operator CLI**: `escc product retrieve | resolve-role | add | approve |
  candidates | gaps | mine`.
- **Quarantine miner** (`scripts/lib/product-mine.js`): emits review-only
  candidates from untrusted call/email text — never auto-approved.

### Changed

- **Structural candidate/approved firewall (ADR-0012).** Approved entries live in
  the one store file drafters read; field-mined candidates live in a separate
  operator-only area that no drafting skill/agent references or can glob.
  `skills/product-knowledge` is the canonical role-keyed source of truth and the
  ~31 retrieval consumers delegate to it. No prospect identity enters the layer
  by construction; `privacy-purge.js` is unchanged.

### Security

- The product-proof fabrication firewall is enforced by file structure, not a
  prompt instruction: a prose-only drafter cannot reach an unapproved entry, and
  `readApproved()` defensively drops any not-approved/untrusted row. Proven by a
  content-guard threat test.

## [1.1.1] - 2026-06-24

Runtime-hardening patch. A Claude Code plugin/marketplace install does not run
`npm install`, so ESCC's sole dependency (`ajv`) was absent at runtime — which
crashed the entire state-backed machinery and, critically, made the fail-closed
`pre:outbound-send-gate` fail OPEN. This release makes the runtime work without
`ajv` and closes every path by which the send-gate could silently fail open.

### Fixed

- **`ajv` is now optional at runtime.** `scripts/lib/state-store/schema.js` and
  `scripts/instincts/instinct-store.js` load `ajv` in a guarded `try/catch` and
  degrade gracefully (skip schema validation, never crash) when it is absent — so
  every hook, the `escc` CLI, session/context persistence, governance, and the
  instinct engine work in a bare plugin install. With `ajv` present (dev/CI and
  any npm-installed checkout) the schema is still fully enforced. The CI-only
  validators keep their hard requirement, as they always run with dependencies.

### Security

- **The fail-closed `pre:outbound-send-gate` can no longer silently fail open.**
  `scripts/hooks/run-with-flags.js` now blocks (exit 2) whenever the gate cannot
  run to a verdict — a module-load failure (e.g. a missing dependency), a `run()`
  throw, a legacy-child crash, a missing script, or a rejected (path-traversal)
  script path — instead of letting the tool call through (previously exit 0/1).
- **The send-gate is non-disableable.** `ESCC_DISABLED_HOOKS` and hook profiles
  can no longer switch it off (`scripts/lib/hook-flags.js` `FAIL_CLOSED_HOOKS`),
  removing a second, undocumented, unaudited off-switch. The only supported
  relaxation remains the documented, gate-logged `ESCC_OUTBOUND_GATE=off`.

### Changed

- `docs/HOOKS.md` documents the non-disableable invariant and corrects the
  failure-policy exit-code description (a non-fail-closed crash resolves to a
  non-blocking 0 or 1; only exit 2 blocks the tool call).
- `commands/thread.md` fixes a stale rule path
  (`rules/outbound-compliance.md` → `rules/common/outbound-compliance.md`).

## [1.1.0] - 2026-06-23

Outbound enforcement at the tool boundary, plus a batch worklist on-ramp. Closes
the gap where an agent told to "use escc" could call the Gmail/HubSpot MCP tools
directly and bypass every safeguard — because the gates only ran when an ESCC
skill was deliberately invoked.

### Added

- **Four deterministic outbound gates** (`scripts/lib/outbound-gates.js`):
  timing / do-not-contact-until, claim-vs-record (the fabrication firewall),
  WIIFM, and contactability (open-deal / demo-booked / handed-to-AE / customer /
  previously-declined). Each emits pass/block + reason; blocks can write the
  do-not-contact list.
- **Per-recipient approval tokens** keyed by `recipient + sha256(subject+body)`,
  tool-agnostic so one approval covers a draft and its later send, with a
  configurable TTL (`ESCC_OUTBOUND_APPROVAL_TTL_MINUTES`, default 7 days).
- **Do-not-contact blocklist** (`do_not_contact` state-store table) the gates
  write and the send-gate reads; a blocklist hit beats an approval token.
- **Blessed path + CLI** — `escc outbound approve | check | review-pack`
  (`scripts/lib/outbound-approve.js`), wired into the `email-outbound-ops` skill.
- **Batch worklist orchestrator** — the `worklist` skill, the `/escc-worklist`
  command, and `scripts/lib/worklist.js`: triage → per-account research → draft →
  gates + reviewer → one consolidated review-pack → approved, gated send → log.
- **`rules/common/outbound-gates.md`** documenting the protocol and the override.

### Changed

- `pre:outbound-send-gate` now enforces at the **tool boundary**: it gates a
  Gmail draft and a HubSpot OUTBOUND email engagement (not only live-send tools),
  requiring an approval token written by the blessed path after the gates pass.
  `config/outbound-tools.json` moves `create_draft` from `allow` to a gated
  `draft` class. Default is block, with a logged `override: <reason>`.
- `privacy-purge` now also erases a subject's do-not-contact rows and outbound
  approval/decision governance rows (the approval tokens carry recipient PII).

### Fixed

- Outbound safeguards now enforce at the tool boundary, not just advise at the
  skill boundary — closing the gap where direct MCP calls (e.g. ~40 unreviewed
  Gmail drafts + HubSpot writes) bypassed the reviewer and the send-gate.

### Notes

- Behavioural change: a draft now fails closed (blocked until it passes the gates
  and a token is recorded). HubSpot tasks/notes/deals/reads are unaffected — only
  outbound email is gated. Override with a logged reason.
- Versioning: a deliberate `0.1.0 → 1.1.0` jump (Lucas's call). Under strict
  semver this feature release (new capability, no breaking API) would be `0.2.0`.

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

[1.1.0]: https://github.com/aura-farming/escc/releases/tag/v1.1.0
[0.1.0]: https://github.com/aura-farming/escc/releases/tag/v0.1.0
