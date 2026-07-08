# Architecture Decision Records (ADRs)

A running log of the significant, locked decisions behind ESCC. Each entry is a
short ADR: **Context** (the forces at play), **Decision** (what was chosen), and
**Consequence** (what follows, good and bad).

This log is seeded from the design spec
(`docs/superpowers/specs/2026-06-12-escc-design.md`) and its Amendment A. Where
the base spec and Amendment A differ, Amendment A wins, and that is reflected
here. Add a new ADR rather than rewriting an old one when a decision changes;
mark superseded entries explicitly.

Status legend: Accepted · Superseded · Proposed.

---

## ADR-0001: Skills-first workflow surface

**Status:** Accepted

**Context.** A Claude Code plugin can express behavior through skills, commands,
agents, and rules. Spreading workflow logic across all four causes drift and
duplication, and makes the routing surface ambiguous.

**Decision.** Skills are canonical. `skills/<name>/SKILL.md` is where workflow
logic lives, with the directory name equal to the frontmatter `name` and the
`description` written as trigger conditions. Commands are thin shims
(<= 20 non-frontmatter lines) that pass `$ARGUMENTS` through and delegate to a
skill. Agents are least-privilege. Rules are layered. If behavior is needed, it
goes in the skill, not the command.

**Consequence.** One obvious home for each piece of logic, and a clean routing
surface (skill descriptions). Commands stay trivial and are CI-checked to
reference a real skill. The cost is discipline: contributors must resist putting
logic in commands or agents.

---

## ADR-0002: The trust boundary is hooks, not prompts

**Status:** Accepted

**Context.** ESCC performs consequential actions (CRM writes, outbound sends)
and ingests untrusted prospect content. Prompt text can be steered or
overridden by adversarial input, so a rule that exists only in prose is not a
control.

**Decision.** Guarantees that matter are enforced in hooks (`scripts/hooks/`),
validated against `schemas/`, and proven by `tests/`. A prompt that "says" not
to do something is guidance; the hook is the control.

**Consequence.** Safety properties are testable and hard to talk the model out
of. Reviewers evaluate safety by asking "is it enforced by a hook and covered by
a test?" The cost is that real guarantees require hook + schema + test work, not
just wording.

---

## ADR-0003: The send-gate fails closed; every other hook fails open

**Status:** Accepted

**Context.** Hooks must not block legitimate work, so the default failure mode
is fail-open. But an un-reviewed or runaway outbound send is a
high-consequence, hard-to-undo action that warrants the opposite default.

**Decision.** Every hook fails open **except** `pre:outbound-send-gate`, which
fails closed. The send-gate blocks a live send until a review-evidence marker
(an `outbound-reviewer` run) is recorded in the state store, blocks on any doubt
(truncated input, unparseable payload, missing config, internal error), and caps
bulk sends via `ESCC_BULK_SEND_MAX` (default 5). Gmail is draft-only by
construction. `ESCC_OUTBOUND_GATE=off` exists only as a documented, dangerous
escape hatch. This polarity must never be inverted.

**Consequence.** A hook bug can never silently block routine work, while
un-reviewed sends are reliably stopped. The cost is occasional friction
(a legitimate send needs a recorded review first); the mitigation is to run the
reviewer, not to disable the gate.

---

## ADR-0004: `crm-operator` is the sole write-capable agent

**Status:** Accepted

**Context.** Many agents read CRM data, but writes to the system of record
(HubSpot) are consequential and must be auditable and narrowly held.

**Decision.** All agents default to read-only. Exactly one agent,
`crm-operator`, holds CRM write tools. Every CRM write routes through it; it uses
review-pack-before-apply on bulk changes and logs every write. CI
(`validate-agents.js`) asserts read-only defaults, `crm-operator` as the sole
writer, and the presence of approval language.

**Consequence.** A single, audited choke point for state mutation, and a small
attack surface. Workflows that need a write must route through `crm-operator`
rather than acquiring write tools themselves. The cost is an extra hop for
write-heavy flows, traded for auditability.

---

## ADR-0005: Node-only, plain-CommonJS machinery with `ajv` as the sole dependency

**Status:** Accepted

**Context.** ECC's machinery includes heavier runtime pieces (e.g. a SQL store).
ESCC targets a single harness (Claude Code) and wants a small, auditable,
build-free dependency surface that is easy to reason about for security.

**Decision.** The machinery plane is Node >= 18, plain CommonJS
(`require` / `module.exports`), with no TypeScript and no build step. `ajv` is
the sole npm dependency; we do not add others and do not hand-roll what `ajv`
covers. The state store is a JSONL rewrite behind the same exported function
signatures as ECC's SQL store.

**Consequence.** Minimal supply-chain surface, no build to break, and schema
validation handled by a battle-tested library. The cost is forgoing conveniences
that a richer dependency set would provide; this is an accepted trade for
auditability in a tool that touches CRM and mail.

---

## ADR-0006: `ESCC_*` environment variables mirror ECC's `ECC_*` names and defaults

**Status:** Accepted

**Context.** ESCC ports ECC's machinery. Renaming env vars freely would create a
parallel, hard-to-cross-reference surface and complicate porting.

**Decision.** Every environment variable is `ESCC_*`, mirroring ECC's `ECC_*`
with the **same names and defaults** (e.g. `ESCC_HOOK_PROFILE` default
`standard`, `ESCC_BULK_SEND_MAX` default 5). Identifiers, paths, and namespaces
use `escc`, never `ecc`. The full surface is documented in `.env.example`.

**Consequence.** Porting and cross-referencing against ECC stay
straightforward, and the documented defaults are predictable. The cost is being
bound to ECC's naming even where a different name might read better; consistency
is judged more valuable than local naming preference.

---

## ADR-0007: Install family/profile model (persona / capability / methodology + synthetic skill components)

**Status:** Accepted

**Context.** Different sales roles need different subsets of the catalog, and the
installer must resolve a coherent set of skills, agents, commands, rules, and
hooks for each role without manual cherry-picking.

**Decision.** Installs are manifest-driven via `manifests/install-profiles.json`,
`install-modules.json`, and `install-components.json`. Profiles are persona
bundles (sdr, ae, sales-manager, revops, full). Components use the families
`persona:*`, `capability:*`, and `methodology:meddpicc`, and the loader
synthesizes a per-skill module and component so any single skill is individually
installable. Install is plan-then-apply and idempotent.

**Consequence.** A persona install resolves to a complete, non-empty module set,
and fine-grained installs remain possible. The default path is the full plugin
marketplace install; the installer also supports rules placement and trimmed
manual installs. The cost is keeping module-to-skill coverage exact (each skill
mapped once), which CI checks.

---

## ADR-0008: Progressive-strictness CI validators

**Status:** Accepted

**Context.** A large catalog is built incrementally. A validator that errors on
every pre-existing imperfection would block all work; one that only warns would
never raise the bar.

**Decision.** Validators in `scripts/ci/` apply progressive strictness:
pre-existing issues **warn**, while new issues **error** under `CI_STRICT`.
Structural and security defects always error. The fix is always to the source
file, never to weaken a validator to pass.

**Consequence.** New contributions are held to the higher bar without an
upfront cleanup of all legacy content, and the codebase ratchets toward
compliance. The cost is some pre-existing warnings persist until addressed; they
are visible but non-blocking.

---

## ADR-0009: MIT adaptation from ECC, reversing ECC's skill-adaptation policy

**Status:** Accepted

**Context.** ESCC is derived from ECC (MIT). ECC's own policy governs how its
skills are adapted; ESCC needs a clear, lawful, and honest stance on attribution
and on the direction of adaptation.

**Decision.** ESCC is MIT-licensed (Copyright (c) 2026 Lucas) and credits ECC
for the adapted machinery in `LICENSE` and `README.md`. Ported machinery files
carry an attribution header pointing back to ECC. ESCC **reverses** ECC's
skill-adaptation policy: rather than merging vendor-branded surfaces wholesale,
ESCC salvages ideas and structure and re-expresses them as ESCC-native sales
content with upstream credit. New skills use `origin: ESCC`; adapted ports use
`origin: ECC-adapted`.

**Consequence.** Attribution is clear and the engineering-to-sales content
replacement is principled and auditable. The cost is the extra work of
re-authoring content natively instead of copying it, which is the intended
trade-off.

---

## ADR-0010: Long-horizon context lives in per-entity account memory (Amendment A)

**Status:** Accepted

**Context.** The completeness audit found that all persistence was
session-scoped, so ESCC did not actually hold context across months — a
non-negotiable requirement for account-based selling.

**Decision.** `account-memory` is the canonical per-entity store. `session:end`
appends tagged events to the active account/deal memory; `session:start`
hydrates the active deal's memory and aggregates all unresolved promises and
near-close deals from the state store, decoupled from any 7-day gate. Promises
are first-class state-store records, and SessionStart injection is
priority-budgeted by category up to `ESCC_SESSION_START_MAX_CHARS`.

**Consequence.** A promise or piece of account context created weeks earlier
surfaces in a later session for the active deal, and account memory doubles as
the handoff payload between personas. The cost is more persistence machinery and
the retention knobs (`ESCC_MEMORY_RETENTION_DAYS`,
`ESCC_OBSERVATION_RETENTION_DAYS`) needed to keep durable stores bounded.

---

## ADR-0011: Instincts re-modeled for sales — outcome-weighted, untrusted-safe, manager-gated (Amendment A)

**Status:** Accepted

**Context.** ECC's continuous-learning engine keyed instincts on git
remote/repo path and weighted them by frequency — neither of which fits a
HubSpot + Gmail sales surface, where learning from untrusted prospect content
would be actively dangerous.

**Decision.** The instinct engine is a Node rewrite (not ECC's Python/bash
subsystem, preserving the `ajv`-only dependency rule). Personal scope is keyed on
rep identity; account/segment applicability uses an `applies_to` field.
Confidence is weighted by real outcomes (reply received, meeting booked, stage
advanced), not frequency. Instincts may be derived only from user-prompt
corrections, user-initiated tool sequences, and error resolutions — never from
tool-output (untrusted) content, which is enforced in code and asserted by a
content-guard test. A decay model ages instincts, personal-to-team promotion is
manager-gated, and `/instinct-status` is the actionable human-review surface.

**Consequence.** Learning reflects what actually works and cannot be poisoned by
adversarial prospect content, and team-level knowledge spreads only under
explicit human review. The cost is a more elaborate engine with decay,
applicability filtering, and gated promotion, all of which are tested.

---

## ADR-0012: Persona/role-keyed knowledge layer — a structural candidate/approved wall

**Status:** Accepted

**Context.** ESCC drafts real outbound from one approved product-knowledge store
(`<agent-data-home>/escc/product/product-knowledge.json`), keyed today only by
free-text `segment`, with four `type` values, no JSON Schema, no coded retrieval,
and retrieval performed in prose by **prose-only drafting agents** (tools
`Read`/`Grep`/`Glob`, no code execution). The fabrication firewall — *"no
approved proof for this slot, say so"* (`skills/product-knowledge/SKILL.md`) — is
what makes the store safe to quote. We need to write to a contact's **role** and
**stack**, not just industry: value-props/proof tagged by role, an objections
library, a persona-to-pain map, and committed battlecard data. This deliberately
pipes field data (calls, emails) *toward* the store — exactly where fabrication
could leak in — so the firewall must come out **stronger**. A retrieval *function
the drafter calls* cannot be that firewall: a prose-only drafter cannot execute
code, so any "return approved-only" logic degrades to a prompt instruction — the
drift this design exists to kill. A `Read`-hook cannot strip rows either: it sees
only the path, not the bytes; there is no PostToolUse `Read` matcher and no
in-flight Read-rewriting precedent (`scripts/hooks/attachment-quarantine.js`,
`hooks/hooks.json`). Only `pre:outbound-send-gate` fails closed
(`scripts/lib/hook-flags.js`).

**Decision.** The candidate/approved wall is enforced by **physical separation**,
not by prose. Approved entries stay in the single file every drafter is pointed
at; field-mined or inferred entries (`approved:false`, `untrusted:true`) are
**candidates** that live in a sibling `candidate/` path **no drafting skill or
agent references or can glob** — so a prose-only drafter is *structurally* unable
to reach an unapproved row. Candidate review and candidate→approved promotion are
**operator-only** (mirroring the instinct lifecycle's separate registry +
operator action, `scripts/instincts/lifecycle.js`); promotion is the same human
gate the store uses today (`approved_by` set by a person). "One store" means one
*taxonomy*, not one *file*: a first product-store JSON Schema (mirroring
`schemas/state-store.schema.json`) adds `type` values
`objection`/`pain`/`battlecard` and **optional** tags `role` + `competitor`
alongside `segment` — all new fields optional, so existing entries validate
unchanged — and rejects the contradiction `approved:true` + `untrusted:true`.
Approved **battlecard facts** become `battlecard`-type entries (`competitor` +
`differentiation` + `guardrail`); the existing `.md` cards remain the human
working surface, not the quotable source. A controlled vocabulary
(`config/`-committed, validated by a disk-loading test) closes the `role` /
`segment` (the store's *industry* values) / `competitor` sets and maps a HubSpot
`jobtitle` to a role with an explicit fallback (unknown → `general`, which still
retrieves general proof); role resolution at draft time uses the existing HubSpot
read tools through a read-capable agent, since drafters have none. A pure coded
retrieval ladder (`scripts/lib/product-knowledge.js`, mirroring
`scripts/lib/account-memory.js`) — role+segment+competitor → role+segment →
segment → general, approved-and-fresh only, with an explicit "no approved proof"
sentinel — is a **convenience for code-capable callers** (the operator CLI,
hooks, worklist), **not** the drafter's enforcement (the physical separation is).
New types carry **no prospect identity and no verbatim quotes by construction**
(objections store an abstracted `pattern`; battlecards assert differentiation,
not claims about a person); identity stays in account-memory, which
`privacy-purge.js` already reaches, and a test proves the layer holds none — so
purge is **not** extended. `battlecard`/`pain` entries get a shorter re-verify
cadence and are treated as hypotheses when stale; clean misses are gap-logged;
operator CLI verbs (`escc product add` / `approve`) mirror the instinct operator
path. Auto-inferred **resonance** and the **ongoing outcome-fed ingestion loop**
are **deferred** — both self-reinforce with multi-causal attribution and are the
fabrication failure mode automated; a reserved `resonance` field, if present, is
human-write-only and unwired.

**Consequence.** The firewall becomes structural and stronger: unapproved content
is unreachable by *where it lives*, not by what a prompt says, and field-mined
data can enter only as an operator-reviewed candidate. Existing entries and every
current drafting flow keep working unchanged (new fields optional; absence ⇒
today's behavior). The costs: the ~31 retrieval consumers must converge onto the
one coded model (removing divergent prose ladders); role-at-draft is entirely new
wiring (`jobtitle` is fixture-only today); and a disk-loading schema-validation
test is net-new (no prior precedent). An optional fail-closed path-block
`Read`-hook on the candidate path (registered in `FAIL_CLOSED_HOOKS`, mirroring
the send-gate) can be added later as defense-in-depth, but it presupposes the
physical separation and is not load-bearing.

---

## ADR-0013: Open-source readiness — company-neutral by construction, enforced by CI

**Status:** Accepted

**Context.** ESCC is being prepared for public open-source release for any sales
team worldwide. The v1.2.0 persona/role knowledge layer (ADR-0012) shipped with
the maintainer's own employer baked into committed example/seed data: the
controlled vocabulary (`config/knowledge-vocab.json`) carried that company's real
competitors and industry segments, and the product-knowledge examples plus several
test fixtures named the company, its competitors, and a `help.<company>` URL. A
repo-wide audit found the leak is small and concentrated — ~10 files, all orbiting
the product-knowledge layer (the "~90 hits" of a naive case-insensitive grep were
the brand as a substring inside "standard" / "meeting-standards", not the brand
itself). No credential was ever committed — in the working tree OR anywhere in git
history — and there was no CI guard preventing either a brand name or a secret
from being committed in the first place.

**Decision.** ESCC is **company-neutral by construction, enforced by CI** — not by
reviewer diligence. (1) The shipped controlled vocabulary becomes a generic,
cross-industry template (`competitors: []`, `segments: ["general"]`, cross-industry
roles plus a generic title map); a rep's real vocabulary lives in a per-workspace
override at `<data-home>/escc/product/knowledge-vocab.json` via a new `loadVocab`
precedence tier (inline > vocabPath > **workspace** > shipped template >
general-only fallback), seeded by `escc product vocab init` and extended by
`escc product vocab suggest`. No company data is migrated into the repo — the
maintainer re-feeds their own data into their gitignored workspace. (2) All
company-identifying tokens are removed from committed example/seed/test data and
replaced with neutral placeholders (`Example Co` / `competitor-x` / `Example Operator`).
Legitimate authorship (the MIT `LICENSE` / `plugin.json` author) is **kept** — it
is not a company token. (3) Two CI validators make it un-regressable:
`validate-no-company-tokens.js` (a banned-brand list in
`config/banned-company-tokens.json`, word-boundary matched so it never trips on a
substring) and `validate-no-secrets.js` (high-confidence credential signatures),
both scanning only git-tracked files so they never false-fail on gitignored
runtime data. (4) Runtime paths that hold mined company material — `voice/`,
`patterns/`, and learned/pending instincts — join the existing runtime stores in
`.gitignore`. **Git history is left intact and scrubbed going forward**: there is
no credential to purge and only the maintainer's own public brand name in example
data, so a destructive `git filter-repo` rewrite (which would break every commit
SHA, all merged PRs, and all clones) buys no security and is rejected.

**Consequence.** Anyone can install ESCC and get a clean, generic harness; their
own company data only ever exists in their gitignored workspace. A brand name or a
credential can no longer be committed without failing `npm test`. The costs: the
shipped vocabulary is intentionally empty of competitors/segments (reps seed their
own via `escc product vocab init` or the forthcoming `/ingest` intake), and the
two new validators add to the CI surface. Phases B (drag-and-drop `/ingest`) and C
(per-account tone-match) build on this clean base and ship after it as v1.4.0 and
v1.5.0. This is an amendment to ADR-0012, which remains in force.

---

## ADR-0014: `/ingest` knowledge intake routes to existing surfaces; no new trust boundary

**Status:** Accepted

**Context.** ADR-0013 ships the knowledge layer deliberately empty — a generic
vocabulary, no competitors or segments, no proof. A rep seeds it today only
through discrete CLI verbs (`escc product add`, `escc product vocab init`). The
common real-world starting point — "here are our case studies, our pricing, a
few call transcripts, a competitor one-pager, and the industries we sell to" —
had no on-ramp. The risk in building one is exactly where it bites: an intake
path is where untrusted content (a call transcript carries the prospect's words;
a competitor doc is the competitor's own marketing) and unvetted claims try to
enter the system, so it must not become a hole in the candidate/approved
firewall (ADR-0012), the style/content split (ADR-0013), or the
attachment-quarantine discipline (CLAUDE.md §3).

**Decision.** `/ingest` (the `knowledge-intake` skill) is an intake **router**,
not new machinery. (1) It classifies a dropped file from its name and the user's
description, shows a dry-run routing plan, and on approval routes each part to a
surface that already exists: STYLE (sent emails / brand doc) → the brand-voice
VOICE PROFILE; account CONTEXT (a call transcript) → the `discovery-notes`
workflow (MEDDPICC capture + a CRM proposal `crm-operator` executes); product
CLAIMS (case study / pricing / security / a stated claim) → `escc product add`
as a candidate; a competitor doc → a `battlecard` candidate plus a
competitor-vocab suggestion; an ICP / industries list → `escc product vocab
suggest`. (2) **Only STYLE and account CONTEXT auto-apply.** Every product CLAIM
enters as an operator-reviewed candidate (`approved:false` + `untrusted:true`,
forced by `appendCandidate`) and becomes quotable only when a human runs `escc
product approve` — the firewall is unchanged. (3) **Untrusted content is read
only by a read-only quarantine subagent** (`transcript-analyzer` for
transcripts, `competitor-analyst` for competitor docs); the privileged
orchestrator works only from the cleaned structured summary, exactly as
`discovery-notes` does. (4) The skill **never uses `escc product mine
--from-transcript`** — that flag reads raw bytes via the CLI's `fs`, which
bypasses the Read-tool quarantine hook; instead the orchestrator transforms the
subagent's structured summary into candidate structs and ingests them with `escc
product mine --input`. It is placed with the cross-cutting skills, whose
`skills-foundation` dependency guarantees `product-knowledge` is present to route
into (the meta group has no such dependency).

**Consequence.** A team can seed the whole knowledge layer in one guided pass
without weakening any guarantee: nothing is approved or sent, claims wait behind
the human gate, account context flows through the existing CRM path, and raw
untrusted bytes never reach a privileged context. Two limitations are accepted
and documented in the skill itself: account-memory has no append CLI
(`appendEvent` is Node-only and durable narrative is hook-populated, so `/ingest`
routes account context through `discovery-notes` rather than writing memory
directly), and a file at a quarantine path or an `.eml`/`.msg`/`.mbox` cannot be
read by the read-only subagent either (nothing sets `ESCC_QUARANTINE_CONTEXT`),
so the skill asks the user to paste or re-save such content as plain text —
hardening that gap (a per-subagent quarantine context) is deferred. ADR-0012 and
ADR-0013 remain in force. Ships as v1.4.0; the per-account tone-match (Phase C)
follows as v1.5.0.

---

## ADR-0015: Per-account tone-match — a deterministic STYLE overlay, firewalled from claims

**Status:** Accepted

**Context.** ADR-0013 drew the style/content split: STYLE (tone, register, the
buyer's lexicon, account history) is learned from untrusted history and applied
freely; CONTENT (claims, metrics, names) comes only from approved
product-knowledge. The rep-level brand-voice `[VOICE PROFILE]` captures how the
*rep* writes — but a message that sounds like the rep can still miss how a
particular *account* writes: a CFO-led enterprise buyer who writes in long,
formal paragraphs reads nothing like a founder who fires back three-word
replies. Phase C (v1.5.0) closes that gap with a per-account register, and in
doing so reopens the exact risk ADR-0013 named — mirroring the buyer's words is
a channel through which the buyer's *claims and numbers* could ride back out as
if they were ours, a fabrication-firewall (ADR-0012) breach laundered through
"voice".

**Decision.** The per-account overlay is **STYLE only, enforced at write time**.
(1) A new deterministic, no-ML, no-dependency extractor
(`scripts/lib/account-register.js`) reads the BUYER side of prior correspondence
and computes an observable register — formality, average sentence length,
question rate, greeting/sign-off — plus the buyer's top recurring LEXICON. (2)
The lexicon is **pure-alphabetic terms only**: a token survives only if it
matches `/^[a-z][a-z'-]*$/` with stopwords removed, so a number, percentage, or
currency figure can *never* become a mirrored term, and the renderer never
echoes a source sentence. (3) Storage is a markdown overlay at
`<data-home>/escc/voice/account/<account>.md` (already gitignored), **layered
on — never replacing —** the rep base profile at
`.claude/escc/voice/<rep-slug>.md`; a draft is rep base voice × buyer-role
register × this-account register × mirrored lexicon, with FACTS still sourced
only from approved product-knowledge. (4) The production entry point is an
operator CLI verb (`escc voice account|show`), mirroring `escc product mine`:
the lib is pure and the CLI does the disk I/O. It is **MCP-free** — buyer text
is gathered by the read-only quarantine/thread path (`transcript-analyzer`,
`email-outbound-ops`) and passed via `--input`, so raw bytes never reach a
privileged context and rep-authored copy is never mistaken for the buyer's.
Adding the CLI verb is a **deviation** from the original four-file plan, which
under-specified the entry point; without it the deterministic extractor would
be reachable only from tests.

**Consequence.** Drafts can match an account's register and vocabulary without
ever borrowing its claims: the leak is closed by construction (a digit-bearing
token cannot be a term) and pinned by a content guard
(`content-guard-lexicon-leak`) that plants a buyer metric and asserts it never
reaches the overlay. The overlay is per-account runtime data, so it lives only
in the gitignored workspace. Limits accepted and documented: the register is
computed from whatever buyer text the orchestrator supplies — there is **no
auto-mining of account-memory**, whose events are mostly rep notes, because
feeding the rep's own side would mis-read the register; greeting/sign-off
detection is best-effort; and auto-inferred resonance plus the outcome-fed
ingestion loop remain DEFERRED (ADR-0012). ADR-0012 and ADR-0013 remain in
force. Ships as v1.5.0 — the last of the Phase A→C roadmap set by ADR-0013.

---

## ADR-0016: Auto-invocation is an architecture — a budgeted routing surface plus deterministic hint hooks

**Status:** Accepted

**Context.** ESCC is skills-first (ADR-0001), and Claude Code auto-invokes a
skill from its frontmatter `description` — but that listing lives under a
context budget (~1% of the model's context window; overflowing descriptions
are dropped, names kept). ESCC's 66 descriptions had grown to **39,193 chars
(avg 594)** — 2.6× over the observed budget even on a large-context model —
so most of the catalog, including flagship skills like
`prospecting-pipeline`, `reply-handling`, and `trigger-detection`, carried
**no trigger text in context and could not auto-invoke at all**; six
command-less skills had no invocation path left but exact-name recall. Nothing
routed at prompt time (the UserPromptSubmit event was reserved in ESCC's own
hook schema but unwired), and nothing chained a finished tool result to the
obvious next play. The plugin *felt* like 68 slash commands you had to know.
An audit also found five trigger-phrase collision clusters (forecast /
follow-up / call / pipeline / deal) where sibling skills claimed the same
phrases.

**Decision.** Reliable auto-invocation is engineered as **three independent
layers**, each of which degrades gracefully without the others. (1) **Fit the
budget:** every skill description is a compressed trigger line — capability
clause plus 2–4 highest-signal trigger phrases, with unique phrase ownership
resolving the five collision clusters — totalling 12,645 chars; the detail
moved nowhere, it already lives in each skill's required "When to Activate"
body section. `validate-skills.js` pins this (>220 chars per description or
>14,000 total fails the build), because an over-budget routing surface fails
*silently* — the worst kind of regression. (2) **Route despite the budget:**
a new `prompt:intent-router` UserPromptSubmit hook keyword-matches the prompt
against `config/skill-keywords.json` — priority-ordered (compliance first,
specific before general), ~60 routes — and injects ONE `escc:<skill>` hint.
It is deterministic data, not a model call; it skips already-routed prompts
(slash commands, explicit `escc:` mentions); and it works even where the
harness truncated a description — the budget-independent layer small-context
models rely on. (3) **Chain the workflow:** a new `post:chaining-hints`
PostToolUse hook proposes the next play after a high-signal tool result
(transcript → `discovery-notes`; Gmail thread → `reply-handling`; HubSpot
**deal** read → `deal-review`, gated by an `input_match` filter so
contact/company reads stay silent), at most **once per chain family per
session** via a per-session temp-file marker — a worklist doing forty CRM
reads gets one hint, not forty. A startup-only `/daily` nudge (lowest-priority
session-start block) completes the loop. Both hooks are **pure hints**: they
never block, never rewrite anything, fail OPEN on any error, and are plain
config + ~150-line scripts with zero new dependencies. The hint format names
the skill and says "ignore if this misreads the ask" — the model, not the
hook, decides.

**Consequence.** Every skill is visible to auto-invocation again on
large-context models; on small-context models the deterministic router still
routes; and the plugin proposes next plays instead of waiting to be asked —
with the trust boundary unmoved (the send-gate and every enforcement hook are
untouched; hints carry no authority). Costs accepted: terser descriptions
lean harder on skill bodies for nuance; the keyword and chain tables are new
maintenance surfaces — mitigated by CI (unit tests assert every route/chain
points at a real skill directory, and the collision clusters have regression
tests); and a keyword hint can occasionally misread an ask — mitigated by
one-hint-max, skip rules, and explicit ignore language. Fixed alongside: a
date-bomb in the send-gate's clean-path test (an approval pinned to a past
date whose 7-day token had expired — the gate was right, the test was wrong).
Ships as v1.6.0.

---

## ADR-0017: First-run checks reality, and coverage gaps close inside existing invariants

**Status:** Accepted

**Context.** The v1.6.0 UX audit found two classes of remaining friction.
First, **first-run failed silently**: `configure-escc` and `team-init` never
verified that the MCP stack was actually connected, so a rep could complete
the wizard "successfully" and hit dead air on their first
`prospecting-pipeline` run; the persona aliases (`claude-sdr`) were referenced
in three getting-started guides but their setup syntax was never shown; and
the first-run seedings that make an install useful (vocabulary, voice) were
invisible outside feature summaries. Second, **capability gaps**: enrichment
providers (Apollo/Clay) had config templates but no skill ever called them —
the single biggest configured-but-dead surface — and the audit named renewal
milestones (absent from the trigger taxonomy), approval-queue visibility, and
proactive referrals as thin spots a sales team would notice.

**Decision.** (1) `configure-escc` becomes a **setup doctor**: a stack-health
step reports each MCP family as connected/missing against a required/optional
tier (HubSpot and Gmail are REQUIRED — a missing one is called out with the
fix and requires an explicit "continue anyway", never a silent pass);
post-install verification runs the machine check (`escc doctor --exit-code`,
offering `escc repair` on drift); and a seeding step offers `escc product
vocab init`, voice/knowledge via `/ingest`, and an optional, shown-before-
written, reversible `skillOverrides` persona routing focus (default: Skip).
The guides now print the real alias one-liner
(`claude --append-system-prompt-file "$ESCC_ROOT/contexts/<mode>.md"`).
(2) A new **`enrichment-ops`** skill (+ `/enrich`) owns enrichment
orchestration under the existing invariants rather than new ones: source
precedence is CRM-record-first → wired provider MCP (detected at runtime,
never assumed) → research-agent web fallback; every field carries provenance
and a `verified`/`reported`/`inferred` confidence label; an inferred email is
never a send target; **unfilled beats invented**; and output is a review-pack
that only `crm-operator` applies — the writer monopoly (ADR-0004) and the
untrusted-input rule are unchanged. (3) The three thin spots close **inside
the skills that own the concern**, not as new surfaces: `trigger-detection`
gains a deterministic renewal-window category (date math from CRM properties,
never fetched — always Concrete) mapped to `renewal-playbook`; `deal-desk`
gains a read-only pending-approvals board with stalled/close-date-risk flags;
`follow-up-ops` gains the proactive referral ask (evidence-backed positive
moments, one ask, no improvised incentives).

**Consequence.** A new rep cannot complete setup while the stack is broken
without being told exactly what is missing, and the install path now seeds
what makes ESCC theirs. Enrichment goes from configured-but-dead to a
governed, provenance-labeled pipeline, and the funnel additions ride existing
review/write paths — nothing new can send, write, or fabricate. Costs
accepted: one more skill and command to maintain (67/69, CI-pinned);
enrichment quality depends on which provider the team wires (the skill says
which source it used, so a weak answer is at least an honest one). LinkedIn
send-automation, eSignature, comp modeling, and win-loss interview automation
remain out of scope (no official API / no MCP / design non-goals). Ships as
v1.7.0.

---

## ADR-0018: One canonical account identity, and a write-back doctrine for every local store

**Status:** Accepted

**Context.** HubSpot is ESCC's declared system of record (ADR-0002 lineage),
but ESCC keeps parallel local stores — account-memory, voice overlays,
promises/outcomes/governance in the state store, instincts — and two
structural problems had grown underneath them. (1) **No canonical account
identity:** `sanitizeAccountId` mapped a company *name* ("Example Co"), its
*domain* ("example-co.example"), and its *HubSpot id* ("12345") to three different
filename stems, so one real-world account fragmented into disjoint
account-memory files, voice overlays, and promise keys that never joined —
the root cause under the v1.7.1 review's three separate source-of-truth gaps
(lossy keys, no unified resolver, no reconcile). (2) **No doctrine for which
truth lives where:** each new feature reflexively added another local JSONL
store, deepening a shadow-CRM in which the more ESCC remembered, the more
truth lived outside the declared system of record, with nothing closing the
loop back to HubSpot.

**Decision.** (1) **Canonical identity is a first-class module**
(`scripts/lib/account-identity.js`), and every per-account store keys through
it. The key grammar is tiered by authority: `company_<hubspot-company-id>`
(tier 1 — HubSpot is the identity authority), `domain_<email-domain>` (tier 2
— pre-CRM prospecting fallback; bare domains, `www.`, and email addresses all
collapse to it), and legacy `deal_<id>` / sanitized-name stems (lossy tiers).
Anything the grammar cannot canonicalize resolves through an **alias index**
(`<data-home>/escc/identity/aliases.jsonl`, append-only, last-write-wins,
mtime-cached): a skill discovers the identity once via a HubSpot search and
records it with `escc identity link "<alias>" company:<id>`; every store
joins forever after. Resolution is deterministic Node — no MCP call on the
hot path. `escc identity backfill` (dry-run by default) merges historical
fragments into their canonical stores, backing up every touched file first
(reversible), appending an `identity_backfill` provenance event, and
re-keying open promises; it is idempotent. `privacy-purge` expands an
identifier to its full **equivalence cluster** (canonical + every alias +
legacy stems + the voice overlay) so the right to erasure reaches
pre-migration fragments. (2) **Every local store is classified** and must
declare its class when introduced: a **DERIVED-CACHE** (reconstructable from
HubSpot; safe to purge; never authoritative when it disagrees with CRM — the
reconcile pass re-syncs it, and derived truth worth keeping is written BACK
to HubSpot as tasks/notes/properties through `crm-operator`, the sole writer)
or a **TRUE-SIDECAR** (data HubSpot structurally cannot hold — narrative
color, learned instincts, writing-style voice, local governance evidence —
which lives here by design). Current classification: account-memory deal
fields (stage/amount/close-date) = derived-cache, reconciled by
`escc reconcile`; account-memory narrative events and open loops, instincts,
voice profiles/overlays, product-knowledge, the alias index, and governance
events = true-sidecar (governance is local evidence of local enforcement).
The doctrine, not reviewer taste, decides where a future feature's state
belongs — "why isn't this a HubSpot object?" must have a written answer.

**Consequence.** "Example Co", "example-co.example", "jane@example-co.example", and "company:<hubspot-id>"
now name ONE store, which makes cross-store joins, the reconcile pass, the
account-truth resolver, and any future team-shared layer trustworthy instead
of silently under-matched — and the historical `example-co.example` vs
`domain:example-co.example` split heals itself at backfill. Costs accepted: a one-time
migration step for existing workspaces (`escc identity backfill`, reversible
via the timestamped backup dir); bare all-digit identifiers are now read as
HubSpot company ids (documented; legacy bare-digit stems merge at backfill);
and name-tier keys remain lossy until a human links them — the resolver says
so and prints the link command rather than guessing. ADR-0010
(account-memory) and ADR-0004 (crm-operator sole writer) remain in force;
write-back happens only through crm-operator. Ships as v1.8.0.

## ADR-0019: The digital twin learns in-session, captures fidelity deterministically, and earns autonomy one gate at a time

**Status:** Accepted

**Context.** After v1.8.0 fed the learning loop (outcomes ledger, canonical
identity, reconcile), the open question was how ESCC should learn the rep
*automatically* — style, accounts, knowledge, judgment, outcomes — instead of
by manual filling. A code-grounded design pass (eight subsystem readers plus
adversarial review) surfaced four things the obvious design got wrong. (1) The
appealing "point cron at a headless `claude -p` session" lane is unsafe as
stated: the fail-closed send-gate is enforced *inside* node processes that
launchd's minimal environment may never spawn, `--bare` (the usual unattended
flag) skips plugins/hooks/gate entirely, and the wired CRM/Gmail/Calendar
connectors authenticate through interactive OAuth that does not exist
headlessly. (2) The earned-autonomy ladder's headline unlock metric —
per-play-class draft revision-rate — has no writer, no store, and no play-class
taxonomy in code, so it cannot accrue history until the release that first
captures it. (3) Machine-written knowledge resonance is exactly the
multi-causal attribution ADR-0012 deferred as "the fabrication failure mode
automated." (4) Cross-cutting guarantees (privacy-purge reach, session-start
injection trust, send-gate ledger growth, rollback of poisoned stores,
cold-start) sit *between* subsystems and were unowned.

**Decision.** (1) **The twin learns in-session (lane L-C).** The morning sweep —
batch CRM reconcile, enrichment review-packs, pre-staged call-prep briefs — runs
when the rep opens the first `/daily` of the day, with connectors authed, hooks
guaranteed, and a human present; it persists prepared work onto the state-store
`work_items` table (`source:'morning-prep'`) as **structured whitelisted fields
only** (canonical account key, ISO meeting time, skill pointer, `generatedAt`,
CRM `asOf`, a brief-file pointer) — never free-text prospect strings — so a
calendar title cannot become a durable cross-session prompt-injection vector.
The sweep is built as a scheduler-agnostic skill + CLI verbs; a headless
launchd lane (L-A) is a later opt-in pilot behind five written preconditions
(verified hook-spawn semantics, a hardened per-job plist, zero gated tools +
`--bare` forbidden, a version-parity pre-step, and the drain race fixed).
Claude-hosted Routines (L-B) are rejected for this release: they cannot read the
local JSONL state the whole source-of-truth investment lives in.
(2) **Fidelity is captured deterministically, never model-declared.** Per-item
content keys are persisted at review-pack time; at approve time the approve-key
is compared against the latest pack-key for that recipient — equal ⇒
`draft_approved_unedited`, different ⇒ `draft_revised`. The two new outcome
types carry the content key in `fingerprint` for per-message traceability and
are deliberately kept OUT of the instinct-confidence domain map, so a productive
class cannot silently push pending, unapproved instincts over the injection floor.
(3) **Autonomy is earned one gate at a time.** v1.9.0 ships L1 (the existing
blessed path), L2 (a daily batch review-pack), and a **narrowed L3** —
auto-apply restricted to HubSpot task/note *creation* through `crm-operator`
(the sole-writer monopoly untouched), backed by a fail-open applied-writes
ledger and a daily after-pack; property/stage/owner/amount writes stay
review-before until prior-value snapshots make them reversible. The grant /
revocation / per-day-cap data model lands **dark** (issuance disabled). **L4
auto-send is deferred to v2.0.0 behind its own ADR** — it is the first
unreviewed live outbound in the system's history, its unlock metric cannot
accrue until this release's capture ships, and the send-gate may only ever
tighten. When it ships, class membership is anchored ONLY in local append-only
ledgers (a `meeting_booked` outcome or a prior approval row for that recipient),
never in model-supplied records; grant creation checks manager role
unconditionally (attestation + audit trail, not a signature); auto-tokens carry
minute-scale TTLs; and the content-bound self-digest token (v1.8.0) is the
proven pattern the gate admits unchanged.
(4) **Machine-written resonance amends ADR-0012.** Resonance may be
machine-written as a **descriptive count with provenance** (source outcome ids,
content keys, method, timestamp), joined to claims used in a draft ONLY on the
exact outbound content key (the account×time-window fallback is rejected as the
very attribution fantasy ADR-0012 named), **barred from any draft-selection or
ranking path**, and applied only after an explicit operator accept of a staged
proposal — mirroring the candidate→approve human gate. This, and v1.9.0's
auto-mining of processed transcripts into candidates, supersede product-mine's
"seeding only, loop deferred" scope line; the fabrication firewall
(candidates/proposals stay `approved:false`+`untrusted:true` until a human
promotes) is unchanged. Cadence-pattern mining is a declared *fourth* instinct
source (rep-action metadata — timestamps and counts, never message content),
emitting low-confidence PENDING instincts through the unchanged `/instinct-status`
gate. (5) **Purge coverage is a declared doctrine.** Every state-store table and
owned sidecar declares a purge strategy in `privacy-purge.PURGE_STRATEGIES`, a
content-guard test fails the build if a table is undeclared, and the twin-writer
stores (`outcomes`, `promises`, `work_items`, the notify queue, session metrics)
are auto-erased on `--confirm`. Poisoned-store rollback ships as `escc outcome
void`, an overlay `.bak` before every overwrite, and a per-store undo table.

**Consequence.** "Learn the rep automatically" ships as an in-session,
human-gated, deterministically-instrumented system in which every hard
invariant survives untouched: the send-gate is never modified and only
tightens, `crm-operator` stays the sole CRM writer, prospect content stays
untrusted, and no machine write becomes quotable/sendable/active without the
existing human gate. Deferring the headless lane and L4 costs no calendar time —
the earned-autonomy clock cannot start until this release's fidelity capture
exists — and buys a full release of real convergence data plus an ADR-grade
review of the first unreviewed outbound. Costs accepted: the first `/daily` of
the day runs a slower inline sweep; prep quality depends on the rep opening a
session; and resonance/fidelity signals accrue slowly (attestation-bound), so
the twin surfaces render "starved — needs N more samples" honestly rather than
implying confidence it has not earned. ADR-0012 (fabrication firewall), ADR-0004
(crm-operator sole writer), ADR-0016 (hint-only chaining), and ADR-0018
(canonical identity, store doctrine) all remain in force. Ships as v1.9.0.
