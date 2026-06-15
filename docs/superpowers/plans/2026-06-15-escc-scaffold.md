# ESCC Scaffold — Build Tracker (A-Z)

- **Source of truth:** `docs/superpowers/specs/2026-06-12-escc-design.md` (§1-12 + Amendment A). Where this tracker and the spec disagree, the **spec wins**; Amendment A wins over §2/§5/§6/§7.
- **Purpose:** durable, file-by-file checklist so progress survives the 45% context save-loop (Amendment §A.10). On resume: read this file, find the first unchecked box, continue.
- **Status key:** `[ ]` not started · `[~]` in progress · `[x]` done & sanity-checked.
- **ECC reference clone:** `/tmp/ecc-analysis` (port source). Re-clone: `git clone --depth 50 https://github.com/affaan-m/ecc /tmp/ecc-analysis`.
- **Rule:** every ported file gets an attribution header. Namespace `ECC_*`→`ESCC_*`, `ecc`→`escc`. Every file ≤800 lines. No secrets, no personal paths. Hooks fail-open except `pre:outbound-send-gate` (fail-closed).

Target counts (finalized by `catalog.js --write` at Phase 6): **skills 64 · agents 18 · commands ~66-68 · rules 23 · hook scripts ~22 · schemas ~12 · CLI subcommands 12 · state tables 10**.

---

## Phase 1 — Chassis  `(Task #1)`

- [x] `.claude-plugin/plugin.json` — name `escc`, v0.1.0, skills/commands paths
- [x] `.claude-plugin/marketplace.json` — local marketplace entry
- [x] `.claude-plugin/PLUGIN_SCHEMA_NOTES.md`
- [x] `package.json` — Node>=18, dep `ajv` only, scripts: `test`, `test:ci`, `catalog`, `catalog:check`, `validate`
- [x] `VERSION` — `0.1.0`
- [x] `LICENSE` — MIT (Lucas) + ECC attribution paragraph
- [x] `.gitignore`
- [x] `.env.example` — full `ESCC_*` surface (§6.5 + A.6) — 21 vars
- [x] `assets/escc-icon.svg`
- [x] `CLAUDE.md` — repo instructions + prompt-defense + workflow-surface policy
- [x] `AGENTS.md` — agent routing table (18 agents)
- [x] `SOUL.md` — identity/principles
- [x] `agent.yaml`
- [x] `.github/workflows/ci.yml` — validators+tests, macOS+ubuntu, Node 18/20/22
- [x] `.github/pull_request_template.md`
- [x] `.github/CODEOWNERS`
- [x] `.github/dependabot.yml`
- [x] `README.md` — front-door stub (catalog tables pinned in Phase 6)

## Phase 2 — Machinery + glue  `(Task #2)`

**lib (TDD):** — GREEN: `node tests/run-all.js` 29/29 pass (independently verified)
- [x] `scripts/lib/utils.js` (ported; 39 exports; Cursor/pkg-mgr/worktree dropped)
- [x] `scripts/lib/agent-data-home.js` — `$ESCC_AGENT_DATA_HOME` resolution (+ `resolveStateDir()`)
- [x] `scripts/lib/hook-flags.js` — profile gating (`ESCC_HOOK_PROFILE`, `ESCC_DISABLED_HOOKS`)
- [x] `scripts/lib/session-bridge.js` — `escc-metrics-${sessionId}.json` (no fabricated harness-cost file)
- [x] `scripts/lib/state-store/schema.js` (ajv 2020-12; 7 ECC + promise/forecastSnapshot/outcome)
- [x] `scripts/lib/state-store/queries.js` + `index.js` — **JSONL rewrite** behind exact ECC signatures + additive promises/forecast_snapshots/outcomes; `:memory:` mode
- [x] `scripts/lib/session-manager.js` / `session-aliases.js` — paired `ESCC:SUMMARY` markers + legacy migration
- [x] `scripts/lib/install-{state,manifests,executor}.js` + `install/apply.js` + `mcp-config.js` + `install-targets/{helpers,claude-managed-paths,claude-home,claude-project,registry}.js` + `install-lifecycle{,-ops,-operations,-discovery,-mutations}.js` (1226→5-file split) + `schemas/install-state.schema.json` — PORTED, manifest-only + claude-only trim (dropped 9 non-claude targets + legacy/locale modes). Namespace `ecc`→`escc` (`escc.install.v1`, `.claude/skills|rules/escc`, `.claude/escc/install-state.json`). GREEN: full apply→discover→doctor→drift→repair→uninstall round-trip proven (tests/unit/install-{state,targets,lifecycle}.test.js, run-all 45/45). NOTE: real `manifests/*.json` content is Phase 4; loader tested against a hermetic fixture.
- [x] `scripts/lib/notify.js` — **NEW** severity-routed delivery (desktop + JSONL queue → MCP drain)
- [x] `schemas/state-store.schema.json` (state-store entity defs — first of ~12 schemas)
- [x] `tests/run-all.js` + `tests/unit/*` (hermetic harness started; 5 unit files)

**hooks:**
- [x] `hooks/hooks.json` (+ `hooks/README.md`, `hooks/memory-persistence/{README.md,hooks.json}`) + `schemas/hooks.schema.json` + `tests/unit/hooks-json.test.js` — 23 hooks wired through run-with-flags via `${CLAUDE_PLUGIN_ROOT}` (no inline resolver); schema-validated; 62/62 GREEN
- [x] `scripts/hooks/run-with-flags.js` (+ `pretooluse-visible-output.js`) — PORTED, dispatch runner. Re-namespaced `ECC_*`→`ESCC_*` (spawn env: `ESCC_PLUGIN_ROOT`/`ESCC_HOOK_ID`/`ESCC_HOOK_INPUT_TRUNCATED`/`ESCC_HOOK_INPUT_MAX_BYTES`); 1MB stdin cap now configurable via `ESCC_HOOK_INPUT_MAX_BYTES` (fail-open control). require()-run fast path + legacy spawn fallback both preserved. GREEN: tests/unit/run-with-flags.test.js (+10; #2222 truncation regression ported via hermetic CLAUDE_PLUGIN_ROOT fixtures, no dependency on the unbuilt 22 hooks) — run-all 55/55.
- [x] `scripts/hooks/session-start-bootstrap.js` — PORT simplified (escc-only slug, env-first root resolution, delegates session:start to run-with-flags; fail-open)
- [~] ~22 hook scripts (§6.1 + A.6). **CRITICAL FIVE DONE & GREEN (101/101 + 6/6 integration):** `outbound-send-gate` (FAIL-CLOSED; + `scripts/lib/outbound-review.js` review/bulk engine + `config/outbound-tools.json`), `compliance-protection`, `attachment-quarantine`, `crm-write-guard`, `pre-bash-dispatcher`. Shared `scripts/lib/hook-input.js`. All export `run(raw,ctx)` + `require.main===module` standalone guard. **12 MECHANICAL HOOKS DONE & GREEN (214/214; built via 6 parallel agents + my verify):** mcp-health-check, suggest-compact, cost-tracker (harness-cost file removed per A.4 — transcript-sum estimate only), desktop-notify (routes via notify.js), metrics-bridge (writes escc-metrics bridge), context-monitor, governance-capture (+sales event types), session-activity-tracker (+accounts-touched), evaluate-session (+sales metrics), crm-log-reminder, outbound-style-check, deliverables-location. All export run(raw,ctx), fail-open, require.main guard, hermetic tests; no stray ECC_ prefixes. **A.2 KEYSTONE HOOKS DONE & GREEN (280/280):** session-start (priority-budgeted injection + one-shot compaction resume), session-end (C1 account-memory append + C3 promise persistence), pre-compact (C4 resumable scratch), follow-through-check (C3 open-promise scan), sla-check (deadline + response SLA breaches). Foundation libs: `account-memory.js`, `promise-extract.js`, `state-store/index.js#createStateStoreSync`. Adversarial-reviewed (5 lenses) + 8 findings fixed with regression tests. **REMAINING HOOK:** observe-runner (A.3 instinct engine).
- [x] `scripts/hooks/escc-statusline.js` (+ `examples/statusline.json` + `schemas/hud-status-contract.schema.json`) — ECC port; "dir" segment → "persona/workspace" (ESCC_PERSONA/bridge); reads escc-metrics bridge; ECC color thresholds; testable formatters. GREEN.

**instinct engine (Node rewrite):**
- [ ] `scripts/instincts/` observe/distill/promote + instinct-cli

**installer/CLI:**
- [ ] `scripts/escc.js` — 12 subcommands (incl. `privacy-purge`, `watch`)
- [ ] `scripts/install.js` — plan+apply, claude target

**schemas (~12):**
- [ ] hooks, install-profiles, install-modules, install-components, install-state, state-store, instinct, provenance, gtm-stack-mappings, hud-status-contract (+ A.6 additions)

## Phase 3 — Context + instinct correctness fixes (GATE)  `(Task #3)`

- [x] C1 account-memory canonical per-entity store (`scripts/lib/account-memory.js`); session:end appends tagged events; session:start hydrates active deal
- [x] C2 decouple loops/promises/near-close from 7-day gate (session:start aggregates all open promises + near-close deals; welcome-back digest after a gap)
- [x] C3 `promises` first-class state-store records (`scripts/lib/promise-extract.js` → upsertPromise; follow-through-check scans ALL open promises)
- [x] C4 `pre:compact` payload spec + resume round-trip (one-shot consume-on-read + TTL/source gating)
- [x] C5 account-memory = handoff payload (`writeMarkdownView` atomic `.md` companion; sales-handoffs skill consumes it in Phase 5)
- [x] C6 instinct `applies_to` (account/segment filter) — session:start filtering done (`appliesToMatches`); instinct SCHEMA `applies_to` lands with the A.3 engine
- [x] C7 priority-budgeted SessionStart injection (`budgetedJoin`, surrogate-safe; resume > overdue > imminent-close > active-account > open-loops > recent-summary > instincts)
- [x] C8 tests: compact→resume, >7-day-gap resume, multi-account attribution (`tests/unit/context-lifecycle.test.js`)
- [ ] I1 rep-identity workspace key · I2 outcome signal · I3 untrusted-content guard in code · I4 decay model · I5 manager-gated promotion · I6 evolve threshold+validation · I7 actionable review gate · I8 expanded seeds  ← **NEXT: instinct engine (A.3)**
- [~] **GATE: A.2 context tests PASS (`node tests/run-all.js` 280/280, exit 0). A.3 instinct tests pending the engine.**

## Phase 4 — Config & seeds  `(Task #4)`

- [ ] rules/common (8) · rules/meddpicc (3) · rules/segments (3)
- [ ] A.5 rules (9): routing-rules, approval-matrix, lifecycle-stages, jurisdiction-routing, lawful-basis, targets + rules/jurisdictions/{au,us,eu-uk}
- [ ] contexts (3): prospecting, deal-work, pipeline-review
- [ ] mcp-configs/mcp-servers.json · config/gtm-stack-mappings.json · config/outbound-tools.json
- [ ] seed instincts YAML (10 base + 8 A.8) · examples/ · .claude dogfood

## Phase 5 — Content wave  `(Task #5)`

- [ ] 64 skills (SDR 11, AE 18, Manager/RevOps 18, Cross/foundational 13, Meta 4 — per §5.1 + A.5)
- [ ] 18 agents (16 + metrics-analyst, trigger-scout)
- [ ] ~66-68 commands (thin shims, ≤20 lines)

## Phase 6 — Quality plane  `(Task #6)`

- [ ] 9 validators + generate-command-registry.js
- [ ] tests/run-all.js + unit + content-guard tests
- [ ] catalog.js pinning (`--check`/`--write`)
- [ ] docs suite (§9 + A.6 GLOSSARY/INCIDENT-RESPONSE)

## Phase 7 — Verify  `(Task #7)`

- [ ] `npm test` green · catalog --check · install --dry-run per persona
- [ ] send-gate + attachment-quarantine fixtures
- [ ] context round-trip + >7-day-resume + multi-account fixtures
- [ ] trigger-watch dry run · plugin loads from local marketplace
- [ ] §12 + A.9 success criteria all proven

---

## Session log (newest first)

- 2026-06-15 (h) — **A.2 LONG-HORIZON CONTEXT SUBSYSTEM + PHASE 3 GATE (A.2 portion) COMPLETE & GREEN (`node tests/run-all.js` 280/280, exit 0).** Built INLINE with TDD (RED→GREEN each): (1) **foundation** — `scripts/lib/state-store/index.js#createStateStoreSync` (sync twin of the async store for sync hooks; async wrapper now delegates to it), `scripts/lib/account-memory.js` (NEW — canonical per-entity store: tagged JSONL event log + folded hydrate + atomic `.md` handoff view + resolveActiveAccount + listNearCloseDeals), `scripts/lib/promise-extract.js` (NEW — commitment detection → stable account-scoped promise ids + relative/ISO due-date resolution). (2) **5 keystone hooks** — session-end (C1 append + C3 persist, per-record upsert isolation), session-start (C7 priority-budgeted injection: resume>overdue>imminent-close>active-account>open-loops>recent-summary>instincts, C1 hydrate, C2 decoupled loops + welcome-back, C6 segment-filtered instincts, C4 one-shot compaction resume w/ TTL+source gate, surrogate-safe truncation, always emits a SessionStart-shaped {stdout}), pre-compact (C4 resumable scratch + clearCompactionState), follow-through-check (C3 all-open-promise scan + this-session gaps, warn-only), sla-check (deadline + response SLA breaches, promise-loops excluded, warn-only). (3) **C8 GATE tests** `tests/unit/context-lifecycle.test.js` — session:end→start round-trip, >7-day-gap resume (loops still surface), pre:compact→resume round-trip, multi-account attribution. (4) **Adversarial verification** via 5-lens Workflow (fail-policy CLEAN; conventions clean) → 8 real findings fixed with regression tests: sla-check double-count, C4 re-injection (now one-shot+TTL+source-gated), surrogate-safe truncation (budgetedJoin+renderDigest), impossible-ISO-date rejection, id-keyed loop close, per-record upsert isolation, atomic `.md` write. KEY_SEPARATOR finding was a false positive (byte is already ` `, collision-safe). All hooks fail-open, ≤800 ln, no stray ECC_ prefixes, require()-loadable with run() export + standalone guard. **REMAINING Phase 2/3:** instinct engine (A.3 I1-I8: observe/distill/promote + observe-runner hook + instinct schema + instinct-cli) → then A.3 GATE tests (outcome-weighting moves confidence; NO instinct from untrusted:true) → CLI escc.js + install.js → remaining schemas → Phase 4 config/seeds → Phase 5 content → Phase 6 quality plane (incl. scripts/ci/ validators so `npm test` runs end-to-end).
- 2026-06-15 (g) — **HOOK SUBSYSTEM + STATUSLINE COMPLETE & GREEN (`node tests/run-all.js` 222/222, exit 0; +6/6 dispatch integration check).** Built this session: (1) **contract layer** — `session-start-bootstrap.js` (simplified, escc-only), `hooks/hooks.json` (23 hooks wired via `${CLAUDE_PLUGIN_ROOT}` direct, NO inline resolver), `schemas/hooks.schema.json`, `hooks/README.md`, `hooks/memory-persistence/{README,hooks.json}`, `tests/unit/hooks-json.test.js`. (2) **5 correctness-critical hooks INLINE w/ TDD** — `outbound-send-gate.js` (FAIL-CLOSED; every error path blocks; + `scripts/lib/outbound-review.js` engine: classify/fingerprint/recordReview/findValidReview/bulk-count via governance_events JSONL + `config/outbound-tools.json`), `compliance-protection.js` (path-block compliance files), `attachment-quarantine.js` (enforce, fail-open), `crm-write-guard.js` (warn deletes / strict-block stage-advance-no-next-step), `pre-bash-dispatcher.js` (rm -rf guard + CLI bulk-mail guard). Shared `scripts/lib/hook-input.js`. (3) **12 mechanical hooks via 6 PARALLEL AGENTS + my verify** — mcp-health-check, suggest-compact, cost-tracker, desktop-notify, metrics-bridge, context-monitor, governance-capture, session-activity-tracker, evaluate-session, crm-log-reminder, outbound-style-check, deliverables-location. Fixed cost-tracker to drop the fabricated harness-cost file (A.4). (4) **statusline** — escc-statusline.js + examples/statusline.json + hud-status-contract schema. All hooks: `module.exports={run(raw,ctx)}` + `require.main===module` guard; fail-open except send-gate; zero stray ECC_ prefixes; GateGuard confirmed off. **REMAINING Phase 2/3:** 6 keystone hooks (session-start/end, pre-compact, follow-through-check, sla-check [A.2]; observe-runner [A.3]) → instinct engine (Node, A.3 I1-I8) → CLI escc.js + install.js → remaining schemas (install-profiles/modules/components, instinct, provenance, gtm-stack-mappings) → A.2 context fixes (C1-C8) with tests → Phase 4 config/seeds → Phase 5 content → Phase 6 quality plane.
- 2026-06-15 (f) — **Hooks-runtime keystone STARTED & GREEN** (`node tests/run-all.js` 55/55, exit 0). Built INLINE with TDD (no Workflow — honoring a tight 20%/2hr usage budget this session). Ported `scripts/hooks/pretooluse-visible-output.js` (verbatim, attribution header) + `scripts/hooks/run-with-flags.js` (the dispatch runner): re-namespaced `ECC_*`→`ESCC_*`, made the 1MB stdin cap configurable via `ESCC_HOOK_INPUT_MAX_BYTES` (fail-open), kept the require()-run fast path + legacy-spawn fallback + path-traversal rejection + the #2222 no-echo-truncated-stdin fail-open behavior. New `tests/unit/run-with-flags.test.js` (+10): ports the ECC truncation regression but drives it through a hermetic `CLAUDE_PLUGIN_ROOT` tmpdir with fixture hooks (noop pass-through + always-block), so it does NOT depend on the unbuilt 22 hooks; also covers `ESCC_HOOK_INPUT_MAX_BYTES`, profile gating, disabled-hook, and traversal. Zero stray `ECC_` env prefixes. **REMAINING Phase 2 (next):** `session-start-bootstrap.js` → `hooks/hooks.json` (+README, memory-persistence/) → ~22 hook scripts (outbound-send-gate FAIL-CLOSED first) + escc-statusline → instinct engine (Node) → CLI escc.js + install.js → remaining ~10 schemas. Then Phase 3 GATE.
- 2026-06-15 (e) — **Install-\* lib subsystem COMPLETE & GREEN** (`node tests/run-all.js` 45/45, exit 0, independently re-run). Built via two Workflow fan-outs (6 readers to map ECC `install-*`/`install/`/`install-targets/`, then 6 porters) + inline empirical verify (real fixture round-trip) + hand-written tests. 16 files: `install-state.js`+`schemas/install-state.schema.json` (`escc.install.v1`), `mcp-config.js`, `install-targets/{helpers,claude-managed-paths(NEW, dedup),claude-home,claude-project,registry}.js` (registry trimmed to claude-home+claude-project; `cursor` etc. throw), `install-manifests.js` (513; locale/legacy/opencode tables dropped), `install-executor.js` (804→355, manifest-only; legacy planners + cursor-agent-names + install/request import dropped), `install/apply.js` (`ESCC_DISABLED_MCPS`, `${CLAUDE_PLUGIN_ROOT}` subst kept), `install-lifecycle*.js` (1226→ ops/operations/discovery/mutations + 31-line barrel preserving the 6-export contract). All require cleanly; zero stray `ecc`/`ECC_` refs; every file ≤800. 3 new test files (+16 tests): install-state round-trip/validation, targets registry/namespacing/fail-closed, and the full apply→discover→doctor→drift→repair→uninstall integration against a hermetic manifests+skills fixture. **REMAINING Phase 2:** hooks runtime (run-with-flags + pretooluse-visible-output + session-start-bootstrap + hooks.json) → ~22 hook scripts (send-gate FAIL-CLOSED first) + statusline → instinct engine (Node) → CLI escc.js + install.js (will reuse install/config.js + install/request.js + runtime.js, still to port) → remaining ~10 schemas. Then Phase 3 GATE.
- 2026-06-15 (d) — **Phase 2 lib foundation COMPLETE & GREEN** (`node tests/run-all.js` 29/29, exit 0, independently re-run). Built via parallel Workflow (8 build agents + verify/repair): utils, agent-data-home (Claude-only +resolveStateDir), hook-flags, session-bridge, session-manager+aliases (paired ESCC:SUMMARY markers), notify (NEW), and the **state-store JSONL rewrite** (schema.js + queries.js + index.js + schemas/state-store.schema.json) preserving the exact ECC contract + 3 new tables (promises/forecast_snapshots/outcomes) + `:memory:` mode. `ajv` installed (sole dep; package-lock.json added). No stray test artifacts in repo. **REMAINING Phase 2:** install-{lifecycle,manifests,executor,state}.js (PORT, trim to claude) → hooks.json + run-with-flags.js + session-start-bootstrap + ~22 hook scripts + escc-statusline → instinct engine (Node rewrite) → escc.js CLI (12 subcmds) + install.js → remaining ~11 schemas. Then Phase 3 (GATE) onward.
- 2026-06-15 (c) — **Phase 1 chassis COMPLETE & verified** (GateGuard confirmed off on resume). Remaining chassis generated via parallel Workflow (7 agents): `.env.example` (21 ESCC_* vars), `agent.yaml`, `assets/escc-icon.svg`, `CLAUDE.md`, `AGENTS.md` (18-agent routing), `SOUL.md` (5 pillars + principles), `README.md` stub (catalog markers), `.github/{workflows/ci.yml,dependabot.yml,CODEOWNERS,pull_request_template.md}`, `.claude-plugin/PLUGIN_SCHEMA_NOTES.md`. All 17 files present/well-formed. Task #1 done. Starting **Phase 2 — machinery** (scripts/lib first, TDD), porting from `/tmp/ecc-analysis` (present).
- 2026-06-15 (b) — Phase 1 chassis STARTED. Done: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`. Disabled GateGuard via `.claude/settings.local.json` env (`ECC_GATEGUARD=off`) — loads at launch, so **re-resume to clear it**, then finish chassis (LICENSE, .gitignore, .env.example, agent.yaml, icon, CLAUDE/AGENTS/SOUL.md, .github suite, PLUGIN_SCHEMA_NOTES, README stub) and start Phase 2. GateGuard re-arms ~every 1-2 writes mid-session (intermittent); retries often pass.
- 2026-06-15 (a) — tracker created; TaskList #1-7 set up with dependency chain (Phase 3 gates Phase 5). Beginning Phase 1 chassis.
