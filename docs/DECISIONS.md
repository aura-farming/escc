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
replaced with neutral placeholders (`Acme` / `competitor-x` / `Example Operator`).
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
