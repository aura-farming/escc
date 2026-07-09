# Changelog

All notable changes to EverythingSales Claude Code (ESCC) are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ESCC is adapted from [Everything Claude Code](https://github.com/affaan-m/ECC)
(ECC) by Affaan Mustafa, under the MIT License. The harness machinery is ported
with attribution; all engineering content is replaced with sales content.

## [1.9.1] - 2026-07-10

The adversarial reviewer is now enforced in the approval path, and a batch ask
routes to the blessed worklist on-ramp. A field test (bulk-drafting ~38 emails
via a hand-rolled loop, in a harness where prompt-level routing never engaged)
showed the fail-closed send-gate holding perfectly while the `outbound-reviewer`
was skipped and the batch never reached `/escc-worklist`. v1.9.1 makes the code
match the documented intent — and only ever *tightens*. Governed by ADR-0020.
See [docs/releases/v1.9.1.md](docs/releases/v1.9.1.md).

### Changed

- **`escc outbound approve` requires an adversarial-review verdict** before it
  mints a per-recipient token (default-on, fail-closed): a review attestation
  `{verdict, confidence}` must be an approval at/above
  `ESCC_OUTBOUND_REVIEW_MIN_CONFIDENCE` (0.8) **in addition to** the four gates,
  and is stamped on the token for audit. `pre:outbound-send-gate` is unchanged —
  only the token's meaning tightens at mint time (a token is harder to earn,
  never easier). (ADR-0020)
- **Intent-router recognizes batch-draft asks:** the `worklist` route gains
  high-precision batch patterns (mass/bulk, `draft N emails`, `these N contacts`,
  `work my list`) and is lifted above the single-message routes.
- **`worklist` / `email-outbound-ops`** now pass the reviewer verdict into
  `outbound approve`, and warn against hand-rolling the batch with
  general-purpose agents (delegate to the dedicated ESCC agents by name).

### Added

- **`--review-verdict` / `--review-confidence` / `--reviewer` flags** on
  `escc outbound approve` (or `review:{…}` in `--input`), and
  **`ESCC_OUTBOUND_REQUIRE_REVIEW`** (default on; `off` for a supervised,
  legacy four-gates-only fallback).
- A once-per-session **post-draft chaining-hint** (`create_draft` →
  `/escc-worklist`); the `post:chaining-hints` hook matcher now includes
  `create_draft`.
- Enforcement + routing regression tests: approval-path block-without-review,
  below-floor, non-approval verdict, valid-review-approves (with audit trail),
  kill-switch, override-bypass; batch routing with negative cases proving
  single-message and prospect-list asks are untouched; the draft chaining-hint.

## [1.9.0] - 2026-07-10

The digital twin: ESCC learns the rep automatically instead of by manual
filling — it prepares the day, keeps the per-account writing voice current from
real correspondence, mines reusable knowledge from every processed call, and
lets the outcomes ledger feed itself, all in-session and behind the existing
human gates. Governed by ADR-0019; design code-grounded and adversarially
pressure-tested first. See [docs/releases/v1.9.0.md](docs/releases/v1.9.0.md).

### Added

- **Prepared day (lane L-C):** an in-session morning sweep (batch
  `escc reconcile`, `accountMemory.listAccounts`) that pre-stages work onto a
  persistent prepared-day store (`escc worklist add|list|done`, structured
  whitelisted fields only), surfaced at session-start and in `/daily`.
- **Style loop:** `reply-handling` / `inbox-triage` / `discovery-notes` now
  build/refresh the per-account voice overlay from buyer text, with a
  sample-count downgrade guard, an `<file>.bak` backup before overwrite, and
  actionable staleness (`ESCC_VOICE_STALE_DAYS`).
- **Knowledge loop:** `discovery-notes` / `call-review` / `meeting-followthrough`
  auto-mine reusable candidates (objections, pains, competitor mentions) into
  the operator-only candidate area (ADR-0012 firewall unchanged).
- **Outcomes loop:** `inbox-triage` auto-attests inbound replies;
  `escc outcome record --thread` dedupes; `escc outcome void <id>` rolls a bad
  outcome back everywhere (filtered at the single `listOutcomes` seam).
- **`escc twin [--days N]`:** a read-only "what the twin learned lately" digest
  with a correction-surface pointer per line.

### Security

- **Privacy-purge reaches every twin-writer store** (outcomes, promises, work
  items, notify queue, session metrics); a content-guard test requires every
  state-store table to declare a purge strategy so none can silently escape
  erasure.
- Quarantine guard on `escc product mine --from-transcript` (refuses quarantined
  paths); per-mine ingest cap (`ESCC_MINE_MAX`) so auto-mining cannot flood the
  review queue.

### Deferred

- Fidelity instrumentation (revision-rate capture + dark autonomy grant model)
  and machine-written resonance (the ADR-0012 amendment) are speced but held for
  a focused follow-up (each carries a schema change). L4 auto-send remains
  deferred to v2.0.0 behind its own ADR.

## [1.8.1] - 2026-07-07

Public-source hygiene release: a full-repo sensitivity audit (tree, docs,
tests, release bodies, git history) plus the guards that make every finding
class un-regressable. No behavior surface changes. See
[docs/releases/v1.8.1.md](docs/releases/v1.8.1.md).

### Security

- **Every example identity is now impossible-by-construction.** All fixture
  domains and email addresses across docs, skills, examples, and tests moved
  to IANA-reserved TLDs (`.example` / `.test` — e.g. `acme.example`,
  `jane@example-co.example`) that cannot belong to any real company or
  mailbox; example CRM ids are abstract (`company:<hubspot-id>`); the
  fictional example company is `Example Co`. Nothing committed can be
  mistaken for — or collide with — real customer data.
- **Scan validators now cover EVERY git-tracked file.** The personal-path,
  secret, and company-token scanners previously skipped root-level files and
  exempted internal scaffolding directories; a personal path had shipped in a
  root doc as a result (removed here, with the internal research doc it rode
  in on). All directory exemptions are gone, and a scope-pin test fails the
  build if any scanner ever grows a directory carve-out again.
- **New `validate-committed-emails.js` guard.** Any email address in a
  committed file must use a reserved-TLD fixture domain (or a subdomain), or
  a config-listed vendor notification address — a real prospect, customer, or
  colleague address can never ship. Allowlist:
  `config/committed-email-domains.json`.
- **The banned-company-token list is now hashed.** The public config carries
  `sha256` token hashes instead of plaintext, so the source no longer
  discloses the very name the guard exists to keep out; the scanner hashes
  every word- and host-shaped candidate (boundary-safe, covers email hosts).
  Plaintext `tokens` remain supported for forks.
- **Vocabulary and provenance neutralized.** Residual origin-identifying
  vocabulary in generic machinery, fixtures, and seeds (WIIFM benefit
  signals, outbound/voice test fixtures, example knowledge entries, a release
  doc) replaced with industry-neutral equivalents; a live-workspace incident
  count and a real-session provenance note removed from historical notes,
  config, and test comments; maintainer references outside the MIT license
  surface replaced with fixture personas. Public GitHub release bodies
  (v1.8.0, v1.3.0) re-edited to the same standard.

### Changed

- Version metadata 1.8.1 across `package.json`, plugin/marketplace manifests,
  `CLAUDE.md`, `SOUL.md`, `AGENTS.md`, `agent.yaml`.
- Catalog unchanged: 68 skills, 18 agents, 70 commands, 30 hook matchers.

## [1.8.0] - 2026-07-07

The source-of-truth release. Three structural fixes from the v1.7.1 strategic
review land together: **one canonical account identity** every store joins on,
a **fed learning loop** (the outcomes ledger and correction signal that were
fully built but starved now have writers), and **"HubSpot wins" as code** (a
reconcile pass, not prose). Plus the account-truth query surface, a
compliance-grade audit CLI, separation-of-duties overrides, scheduled
autonomy, and currency-correct money math. See [ADR-0018](docs/DECISIONS.md)
and [docs/releases/v1.8.0.md](docs/releases/v1.8.0.md).

### Added

- **Canonical account identity (ADR-0018).** `scripts/lib/account-identity.js`
  + `escc identity resolve|link|list|backfill`: `company:<hubspot-id>` is the
  tier-1 key, domains/emails collapse to `domain_<x>`, and an append-only
  alias index joins names to CRM identity ("Example Co" = "example-co.example" =
  "company:<hubspot-id>" = ONE store). account-memory, voice overlays, promise rows,
  and governance events all key through it. `backfill` merges historical
  fragments (dry-run default, timestamped backup, provenance event,
  idempotent); `privacy-purge` now erases the whole equivalence cluster
  (legacy stems + voice overlays + alias rows).
- **Outcome-capture bridge — the learning loop is FED.** `insertOutcome` had
  zero production callers, so instinct confidence never moved on real results.
  Now: `post:outcome-capture` turns HubSpot deal-STAGE writes into
  `deal_stage_advanced`/`closed_won`/`closed_lost` outcomes and Calendar
  events into `meeting_booked` (whitelisted payloads only — never free text);
  `escc outcome record` attests replies; `escc outcome list|summary` inspect
  the ledger. Schema + distill `OUTCOME_DOMAIN` gain the closed_won/lost types.
- **`prompt:capture-correction`.** The engine's strongest signal
  (`user_correction`, threshold 1) finally has a writer: a conservative
  pattern table (`config/correction-patterns.json`) captures explicit rep
  corrections as observations. Nothing auto-applies — the I7 review gate
  (`/instinct-status`) still owns activation.
- **CRM reconcile.** `scripts/lib/account-reconcile.js` + `escc reconcile
  <account> --input <crm.json> [--apply]`: diffs the agent-read CRM snapshot
  against account-memory's folded deal fields, seeds CRM-only deals,
  auto-closes ONLY deal-status loops on closed-won/lost, appends
  `source:'crm-reconcile'` events. Memory-only deals are reported for review,
  never auto-closed. Local-only; crm-operator remains the sole CRM writer.
- **Account truth.** `scripts/lib/account-truth.js` + `escc truth <account>`
  + the `account-truth` skill (`/truth`): one provenance-labeled answer
  joining live CRM (optional snapshot), memory (with staleness), promises,
  outcomes, governance, and voice — with drift shown inline and cold-start
  honesty (no CRM read → says so; product claims stay behind ADR-0012).
- **`escc audit`.** Query/export the governance ledger
  (`--recipient/--account/--event-type/--since/--json`) — "prove we honored
  this opt-out", "list every override this quarter". Typo'd event types are
  refused, not silently empty.
- **Separation of duties (tighten-only).** Approval tokens record
  `approver`/`approver_role`; under the strict profile (or
  `ESCC_OVERRIDE_REQUIRES_MANAGER=1`) an override must be manager-signed —
  refused at approve time AND blocked at the gate for pre-existing rep-signed
  override tokens. Clean four-gates tokens and the standard profile are
  byte-identical to v1.7.1. Every override lands in the notify queue.
- **Scheduled autonomy + notify drain.** `escc watch
  --emit-schedule|--install-schedule` generates/installs the launchd plist
  (crontab line elsewhere) so the signal sweep runs on a cadence; `escc
  notify drain [--clear] [--approve-self <your-email>]` empties the queue and
  can mint a SELF-digest approval token — bound to the exact recipient +
  content, unusable for a prospect draft; the fail-closed gate is untouched.
- **Currency correctness (blocker fix).** `scripts/lib/currency.js` +
  `config/locale.example.json`: amounts carry currency codes, a workspace
  reporting currency + FX table (rate + as-of provenance) normalizes, and
  mixed-currency sums REFUSE rather than silently mixing units.
  `forecasting-definitions.md` owns the policy; forecast-rollup,
  business-case, and quote-desk cite it.
- **Staleness (quick win).** Open loops older than `ESCC_LOOP_STALE_DAYS`
  (default 21) render as "stale — reverify" in digests (never dropped); voice
  overlays expose their last-updated stamp to the truth view.

### Changed

- Governance events carry an optional canonical `account_id`;
  `getGovernanceByAccount` joins them. The send-gate reads the governance log
  ONCE per evaluation (was 3 full-file reads on the hottest fail-closed path).
- Catalog: **68 skills, 70 commands, 30 hook matchers** (CI-pinned);
  `skills-cross` carries `account-truth`; intent-router gains the /truth
  route; reply-handling attests reply outcomes; coaching-prep cites
  `escc outcome summary` (corroborated, coaching-not-surveillance);
  account-memory documents the identity + write-back doctrine.
- `.env.example`: +`ESCC_LOOP_STALE_DAYS`, +`ESCC_OVERRIDE_REQUIRES_MANAGER`.

### Fixed

- A reconcile loop-close event no longer carries `deal_id`, which would have
  let its `status:'done'` overwrite the deal's CRM `won/lost` status in the
  fold (caught by the idempotence test during development).

### Security

- The fail-closed send-gate changed in exactly two ways, both TIGHTENING:
  one governance read instead of three (same verdicts, proven by the
  existing suite), and the strict-profile SoD branch (proven tighten-only:
  standard profile and clean tokens byte-identical). The self-digest token is
  content-and-recipient-bound — tests prove it cannot launder a prospect
  draft. Outcome payloads are whitelisted structured fields (ADR-0012);
  correction capture skips long prompts (likely pasted third-party content)
  and routes through the human review gate.

## [1.7.1] - 2026-07-06

Hardening patch from a full verification run of the plugin (66-check machine
pass over every CLI verb + all 28 hook matchers through the real dispatcher,
plus three parallel audits: cross-references, docs accuracy, adversarial bug
hunt). Everything found is fixed here; no behavior surface is added. See
[docs/releases/v1.7.1.md](docs/releases/v1.7.1.md).

### Fixed

- **SessionStart bootstrap version-skew (the significant one).**
  `session-start-bootstrap.js` resolved the plugin root as env vars →
  `~/.claude` → installed marketplace/cache copies — **never its own tree**.
  When `CLAUDE_PLUGIN_ROOT` was not yet populated (the exact case the
  bootstrap exists for), it silently delegated session hydration to a STALE
  installed copy — reproduced live against a v1.5.0-era marketplace install.
  Self-resolution (`__dirname`) now beats any other install; regression test
  proves a payload from the executing tree (and the env override still wins).
- **chaining-hints false positive.** `input_match` was a substring test on the
  tool-input JSON, so a *contact* read for a company named "Dealify Inc"
  triggered the deal-review hint. It is now a word-boundaried regex
  (`"objecttype":"deals?|0-3"` or a `query` containing the word *deal(s)*),
  with tests for the Dealify case and `query_crm_data`.
- **intent-router cache bleed.** `loadRoutes()` cached the compiled table
  without keying on the plugin root; a second call with a different root
  returned the first root's table. Cache is now root-keyed.
- **Manifest count drift.** `commands-core` description said "All 68" shims;
  regenerating v1.7.0 missed the prose count — now 69.
- **enrichment-ops rule path typo**: `rules/common/lawful-basis.md` →
  `rules/lawful-basis.md`.

### Changed

- **`.env.example` now actually covers the surface** (README promises it): 22
  previously undocumented user-facing vars added with their real code defaults
  (MCP health TTL/timeout/backoff, session-start hydration + compaction
  tuning, quarantine context/dir, outbound review-confidence + tools-config
  override, rep identity/SLA/notify, knowledge volatility, CI scan root), and
  4 documented-but-never-read vars removed (`ESCC_SESSION_RETENTION_DAYS`,
  `ESCC_OBSERVE_TIMEOUT_MS`, `ESCC_OBSERVATION_RETENTION_DAYS`,
  `ESCC_MCP_RECONNECT_COMMAND`).
- **SKILL-DEVELOPMENT-GUIDE** now documents the 220-char description cap and
  the 14k total routing-surface pin (contributors previously hit the CI error
  blind); getting-started guides list the full persona modules
  (SDR: + `enrichment-ops`, `outreach-analytics`; AE: + the six deal-maturity
  skills); `contexts/watch-list.md` references now say it is user-created per
  workspace, not shipped.

### Verified (no change needed)

- Full machine pass green: every `escc` verb end-to-end in a hermetic home
  (install→doctor→repair→uninstall, product/vocab/voice/outbound/watch/purge),
  and the send-gate's blessed path proven through the real dispatcher (CLI
  approval token → matching draft allowed; unapproved draft, live send, and
  malformed stdin all blocked). All cross-references clean: 67 skills, 18
  agents, 69 commands, registry, CLI verbs, rules. No route shadowing or
  ReDoS in the intent-router; no date-bombs remaining in tests.

## [1.7.0] - 2026-07-06

First-run that can't fail silently, and the funnel gaps closed: the
`configure-escc` wizard becomes a **setup doctor** (it checks the MCP stack
against reality, verifies with `escc doctor`, and offers to seed vocabulary,
voice, and persona routing focus), a new **`enrichment-ops`** skill finally
orchestrates the enrichment MCPs that were configured but never called, and
three coverage gaps from the v1.6.0 audit close inside existing skills. See
[ADR-0017](docs/DECISIONS.md) and
[docs/releases/v1.7.0.md](docs/releases/v1.7.0.md).

### Added

- **`enrichment-ops` skill + `/enrich` command.** On-demand contact/company
  enrichment — firmographics, roles, tech stack, contact data — with strict
  source precedence (HubSpot record first → wired enrichment MCP
  (Apollo/Clay, detected at runtime) → research-agent web fallback), per-field
  provenance + confidence labels (`verified` / `reported` / `inferred`), and a
  review-pack proposal that only `crm-operator` applies. An inferred email is
  never a send target; unfilled beats invented. Installed with the SDR
  persona; routed by the intent-router (`"enrich this"`, `"find their
  email"`).
- **configure-escc setup doctor.** New Step 0.5 stack-health check (HubSpot /
  Gmail REQUIRED, Calendar / Fireflies / enrichment optional — missing
  required connections are called out with the fix, never silently passed);
  post-install verification now runs `escc doctor --exit-code` (with `escc
  repair` offered on drift); new Step 6.5 offers first-run seeding — `escc
  product vocab init`, voice/knowledge via `/ingest`, and an optional,
  reversible `skillOverrides` persona routing focus; the summary now teaches
  the persona-alias one-liner and `/daily`.
- **Renewal-window triggers** in `trigger-detection`: a 6th trigger category
  computed deterministically from HubSpot renewal/contract-end dates (never
  fetched), mapped to `renewal-playbook` (health check; expansion mode when a
  growth signal co-occurs).
- **Pending-approvals board** in `deal-desk`: a read-only manager view of the
  approval queue — deal, term, required tier, approver, age — with
  stalled (>2 business days) and close-date-risk escalation flags.
- **Proactive referral ask** in `follow-up-ops`: the referral play no longer
  waits for a dead lead — closed-won kickoffs, strong QBRs, and renewals
  trigger a one-sentence, one-ask referral request (evidence-backed, no
  improvised incentives, logged via `crm-operator`).

### Changed

- Getting-started guides (SDR / AE / Manager) now show the **actual persona
  alias setup** (`alias claude-sdr='claude --append-system-prompt-file
  "$ESCC_ROOT/contexts/prospecting.md"'`) — previously the alias was referenced
  but never defined, a guaranteed first-run dead end.
- Catalog: **67 skills, 69 commands** (CI-pinned); command registry
  regenerated; `skills-sdr` module now carries 12 skills.

### Security

- `enrichment-ops` follows every existing invariant: read-only + propose-only
  (`crm-operator` remains the sole writer), provider/web output is untrusted
  data, PII collection is minimum-necessary per `data-handling.md`, and no
  contact data is ever fabricated or pattern-guessed. The setup doctor only
  reads tool availability; the optional `skillOverrides` write happens only
  after showing the exact JSON and defaults to Skip.

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
  genericized (`Example Co` / `competitor-x` / `Example Operator`). Legitimate
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
  skill boundary — closing the gap where direct MCP calls (unreviewed drafts
  and CRM writes) bypassed the reviewer and the send-gate.

### Notes

- Behavioural change: a draft now fails closed (blocked until it passes the gates
  and a token is recorded). HubSpot tasks/notes/deals/reads are unaffected — only
  outbound email is gated. Override with a logged reason.
- Versioning: a deliberate `0.1.0 → 1.1.0` jump (maintainer's call). Under strict
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
