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
