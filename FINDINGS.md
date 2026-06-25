# FINDINGS — Persona/Role-Keyed Knowledge Layer (ESCC)

**Phase 0 research output.** Read-only investigation of the repo at `feat/persona-role-knowledge-layer`
(HEAD `d8613a8`, in sync with `origin/main` on `github.com/aura-farming/escc`). Gathered by a parallel
6-reader workflow + synthesis + completeness-critic; every claim below carries a `file:line` citation so it
is re-verifiable. **Where the repo contradicted the build brief, the repo wins — those deltas are in §F.**

> **Work-location note.** `/Users/lucas/code/escc` is the canonical dev checkout (remote
> `aura-farming/escc`, `main`, 0 ahead / 0 behind `origin/main`, clean). The marketplace copy at
> `~/.claude/plugins/marketplaces/escc` is at the **same HEAD commit**; its "ahead 9" is a stale tracking
> ref, not newer work. No hidden newer source exists.

---

## A. Current-state facts

**Store location / filename.** The approved product store resolves to `<agent-data-home>/escc/product/`,
where the data home is `ESCC_AGENT_DATA_HOME` if set, else `~/.claude`
(`scripts/lib/agent-data-home.js:50-52,67-72,79-81`). On disk it is a **single file**:
`<home>/escc/product/product-knowledge.json` — one flat JSON array of all entries (live: `PK-01`..`PK-20`,
20 entries) plus a human `README.md`. There are **no per-type files**. The content plane references the store
only as the literal relative string `.claude/escc/product/` (`skills/product-knowledge/SKILL.md:46`;
`agents/outreach-drafter.md:37`) — no skill/agent references the resolver or `ESCC_AGENT_DATA_HOME`. The store
is gitignored (`.gitignore:34`); a comment notes a private workspace may opt to track `product/` and
`battlecards/` (`.gitignore:30-32`).

**Entry shape.** Each of the 20 live entries carries 11 fields (`product-knowledge.json:2-21`): `id`, `type`,
`text`, `segment`, `source_title`, `source_url`, `source_type`, `approved`, `approved_by`, `last_verified`,
`guardrail`.

**Full `type` set.** Skill-defined vocabulary is four values: `value-prop`, `use-case`, `proof-point`,
`claim` (`SKILL.md:48-53`). On disk only three are used; **`proof-point` is defined but unused** (all seeds
are capability claims, not metrics — `product/README.md:7`). No `objection` / `pain` / `battlecard` / `role` /
`competitor` anything exists today.

**`segment` is prose-only.** Free-text, no enum. Values are comma-joined free strings (`"general"`,
`"hospitality, retail"`, `"aged care, healthcare, general"`) and ordering even varies between entries
(`product-knowledge.json:3,4,15,16`) — proof there is no controlled vocab. The de-facto segment set is the
three rule overlays `rules/segments/{enterprise,mid-market,smb}.md`.

**Approval / provenance fields.** `approved` (bool; all live = true; defaults `false` for new
marketing/customer claims until a human clears — `SKILL.md:56-59,82-83`); `approved_by` (string);
`last_verified` (ISO date); `source_type` (skill enum `case_study`/`internal_metric`/`public`/`customer_quote`
— `SKILL.md:56`; live store uses only `"public"`); provenance is **two fields on disk** (`source_title` +
`source_url`) even though the skill names a single `source` (`SKILL.md:55` — divergence, §F-4); `guardrail`
(optional channel restriction, present on every live entry).

**No schema, no coded retrieval — CONFIRMED.** `schemas/` has 10 files, none for product knowledge; no
`scripts/lib/product*.js` exists; grep for `product-knowledge.json` across `scripts/`, `tests/`, `schemas/`,
`config/` is empty. Retrieval is performed entirely by **prose-only agents reading the file directly**, per
the prose ladder in the skill.

**Prose specificity ladder (quoted).** `SKILL.md:67-68`: *"Find the matching entry by persona + segment +
use-case. Prefer the most specific match; fall back to the general value-prop only if no specific proof
exists."* Approval+freshness (`:69-72`): if `approved` and `last_verified` within
`ESCC_MEMORY_RETENTION_DAYS`, return with attribution; else mark `UNVERIFIED — needs approval`. Clean-miss
contract (`:73-74`): *"If no proof exists: say so explicitly — 'no approved proof point for <use-case>'."* The
caller softens to a question/hypothesis, never invents a number. **This is the fabrication firewall.**

**Battlecards state.** `skills/competitor-battlecards/SKILL.md` (310 lines, `origin: ESCC`) defines a
**separate** per-card runtime store `.claude/escc/battlecards/<competitor-slug>.md` (`:54-56`, r/w at
`:79,191`), gitignored. **No committed seed data and no schema.** The card model is a prose markdown table
(`:58-73`) with an in-card `last_vetted`/pending-section convention, not a JSON shape.

**Vocab absence — CONFIRMED.** No controlled list of roles/segments/competitors anywhere (`config/`,
`schemas/`, `rules/`, `skills/`). `config/` holds only `gtm-stack-mappings.json` (stack-detection map) and
`outbound-tools.json` (send-gate tool classification) — neither is a vocab.

**Role-at-draft absence + HubSpot property.** **No drafting path resolves a contact's role/job-title from CRM
as a retrieval key.** "Role-specific pain" is a human-research instruction (cold-outreach `:57,103`);
`{{title}}` is explicitly *"mail-merge, not personalization"* (`:66`); persona is rep-supplied in
outbound-sequences (`:80,103,195`); `outreach-drafter` receives signals as untrusted passed context and has
**no HubSpot tools** (`agents/outreach-drafter.md:49,66`). The HubSpot property is **`jobtitle`**, but it
appears in the repo **only as a test fixture** (`tests/unit/crm-write-guard.test.js:37`) — production never
reads it. Contact properties are fetched via HubSpot MCP read tools by read-capable agents (account-researcher,
deal-reviewer, etc.); title is read narratively, not as a keyed fetch. **Role resolution at draft time is
entirely new wiring.**

**Privacy-purge coverage.** `privacy-purge.js` auto-erases (on `--confirm`) five stores: account-memory,
instinct observations, instincts, do-not-contact, and outbound governance rows (`:8-26` header; `:108-237`).
**CONFIRMED it does NOT cover the product store or battlecards** (zero `product`/`battlecard` hits). New row
types are outside GDPR-erasure *unless* they carry identity (drives the PII decision, §D-3).

---

## B. Precedents to mirror (every new artifact maps to one)

| New artifact | Mirror | Notes |
|---|---|---|
| Product-store JSON Schema (multi-type) | `schemas/state-store.schema.json` | 2020-12, short dotted `$id` (`escc.product-knowledge.v1`), `$defs` primitives, `additionalProperties:false`, per-type `required`; closest analogues for new enum + tags: `outcome.type` (`:508-516`), `doNotContact.scope` (`:549`). |
| Controlled-vocab schema (single record) | `schemas/provenance.schema.json` | draft-07 single object; its flat-string-enum (`source_type`, `:14-17`) is the **pattern** for `role`/`competitor`/`segment` vocab (mirror the *shape*, not its values — see §G note). |
| **Disk-loading validation test** | *NO precedent — new work* | `tests/unit/schemas.test.js` validates only **inline literals**; even `config/gtm-stack-mappings.json` is never loaded from disk against its schema (`:75-84`). Loading a committed config/seed file and validating it is a deliberate improvement, called out as new — not "mirroring." |
| Coded retrieval lib + test | `scripts/lib/account-memory.js` (+ `tests/unit/account-memory.test.js`) | Pure CommonJS; fixed subdir constant via `resolveAgentDataHome`; sanitized caller keys; tolerant reads (ENOENT→`[]`); atomic writes. Hermetic test: `mkdtempSync` + `ESCC_AGENT_DATA_HOME` temp home. |
| Candidate-list / operator review | instinct lifecycle (`scripts/instincts/lifecycle.js:246-265`, `instinct-store.js:302-328`, test `instinct-lifecycle.test.js:210-238`) | Approval held in **separate physical ID-registries** + `listForReview()`. Operator/human-gated. *Distinct from the store's per-entry `approved` boolean — do not conflate.* |
| Firewall threat test | `tests/unit/content-guard-agent-instruction-safety.test.js:1-70` | Greps invariant strings across `agents/*.md`: forbidden write/exec tools absent for all but the sole writer; role-split assertions; frontmatter `tools` parsing. Template for "drafters stay prose-only / cannot reach candidates." |
| ADR | `docs/DECISIONS.md` | `## ADR-NNNN: <title>`, `**Status:**`, `**Context.** / **Decision.** / **Consequence.**`, `---` separated, append-only. **Next number = ADR-0012** (highest committed is ADR-0011; re-grep `^## ADR-` at authoring time, §G). |
| (Optional) fail-closed Read-hook | `scripts/hooks/outbound-send-gate.js` + `scripts/lib/hook-flags.js` `FAIL_CLOSED_HOOKS` | `attachment-quarantine.js` is the only existing PreToolUse `Read` hook **but it fails OPEN** (`:76-78`). A truly fail-closed Read-hook has **no precedent** and would need to mirror the send-gate (block on doubt + register in `FAIL_CLOSED_HOOKS`). |
| Committed seed / disk-loadable fixtures | `examples/` | Existing home for committed example artifacts; the runtime store is gitignored, so committed seed/example entries live here and are what the disk-loading test validates. |

---

## C. Full consumer set (≈31–32 — about double the brief's "~16")

**Retrieval / rewire set** (reads the approved knowledge layer; must converge on one model):

product-knowledge (the model itself), cold-outreach, outbound-sequences, follow-up-ops, proposal-builder,
business-case, objection-handling, competitor-battlecards, demo-prep, rfp-response, qbr-builder, quote-desk,
renewal-playbook, reference-coordination, stakeholder-mapping, prospecting-pipeline, cold-calling, call-prep,
playbook-library, win-loss-analysis, negotiation-prep (indirect), rep-onboarding, sales-reporting, brand-voice,
multi-threading, worklist, **evaluation-plan** *(added by the completeness critic — retrieves approved proof
during a POC, `skills/evaluation-plan/SKILL.md:30,105`)* — **26 skills** — plus agents **outreach-drafter,
proposal-writer, competitor-analyst** (all PROSE-ONLY) and **outbound-reviewer** (read-only verifier).
**Total rewire set ≈ 30–31 retrieval consumers + evaluation-plan ⇒ ≈ 31–32.**

Plus ~8 boundary/guard/routing touchers that reference but do not retrieve (discovery-notes,
account-researcher, transcript-analyzer, crm-operator, deal-review, deal-inspection, account-memory,
account-research), 2 catalog files (configure-escc, escc-guide), and borderline operator paths
(email-outbound-ops, inbox-triage, reply-handling — proof delegated upstream).

**Divergent copies that must converge on the one coded model:** proposal-builder (`:72-78`, full second
ladder), business-case (`:94-103`, full second ladder), rfp-response (`:98-129`, query-by-topic variant),
cold-outreach Gate C (`:78-83,114-121`), and the same clean-miss contract re-typed across outbound-sequences
(`:106-107`), follow-up-ops (`:81-82`), objection-handling (`:59`), demo-prep (`:102-124`), cold-calling
(`:59,341`), prospecting-pipeline (`:189-190`). playbook-library (`:79,101,119`) carries a distinct
ID-set-validation shape. **Two store-path literals disagree and must converge:** competitor-battlecards
(`:54`) and outreach-drafter (`:37`).

**Prose-only (must be defended structurally) vs code-capable (may call the ladder):**
- *Prose-only (Read/Grep/Glob, no code interposed):* agents outreach-drafter, proposal-writer,
  competitor-analyst, outbound-reviewer; and the drafting skills running in the assistant's prose context
  (cold-outreach, outbound-sequences, follow-up-ops, objection-handling, demo-prep, cold-calling,
  stakeholder-mapping, multi-threading, call-prep, reply-handling, inbox-triage, rep-onboarding, brand-voice,
  evaluation-plan).
- *Code-capable / operator (can call a coded ladder):* `scripts/lib/worklist.js`, email-outbound-ops (invokes
  the send-gate hook chain), the operator CLI `scripts/escc.js`, the hook runtime `scripts/hooks/`; plus
  playbook-library / rfp-response do naturally-coded ID-set / topic-query validation.

---

## D. The three decisions (with recommendations)

### D-1. Enforcement model — **RECOMMEND (a) physical separation** (and (b) collapses into it)

Drafters are prose-only and read the store **file directly** (`agents/outreach-drafter.md:37`). A PreToolUse
Read-hook fires *before* the read and receives only the **path**, not the file bytes
(`scripts/hooks/attachment-quarantine.js:61-74`, `scripts/lib/hook-input.js:42-60`); there is **no
PostToolUse `Read` matcher** anywhere (`hooks/hooks.json:113-211`) and **no precedent for rewriting Read
content in flight.** So a hook **cannot strip candidate rows out of a mixed file** — it can only
allow/block/annotate a *path*. To block candidates while still serving approved rows, the candidates must
already live at a **separate path** the hook blocks. **That is option (a).** Option (b) therefore *presupposes*
(a); it is not an independent alternative.

**(a) is airtight here:** approved entries live in the one file every drafter is pointed at; candidates live in
a sibling `candidate/` path **no drafting skill or agent references or can glob**. "One store" = one
*taxonomy* (one schema, one type-set, one ladder), not one *file* — the runtime already separates
committed-repo from data-home, and a sibling dir is idiomatic. An unapproved row is **structurally
unreachable** by a prose-only drafter — enforced by *where the file lives*, with nothing to keep in sync and
no dependence on an unprecedented mechanism. Candidate review is **operator-only** (mirrors the instinct
lifecycle's separate registry + operator action), so candidate→approved promotion is a deliberate operator
step, never drafter-triggerable.

**The coded retrieval ladder is a convenience for code-capable callers, NOT the drafter's enforcement.** The
drafter never executes code; its guarantee is physical separation, full stop. An optional fail-closed
path-block Read-hook (registered in `FAIL_CLOSED_HOOKS`, blocking reads of the candidate path from
non-operator contexts) can be added as **defense-in-depth**, but it presupposes (a) and is not load-bearing.

### D-2. Battlecards — **RECOMMEND: fold approved battlecard *facts* into the one taxonomy as a `battlecard` type**

Requirement A asks for a `battlecard` type in the unified taxonomy; capability 4 notes a separate battlecard
runtime store already exists. Reconciliation: **approved, quotable** battlecard facts (`competitor` +
`differentiation` + `guardrail`) become `battlecard`-type entries in the product store — schema-validated,
approved, role/competitor-tagged, retrieved by the one ladder. The existing `.md` cards remain the
human-authored *working/scratch* surface (live "how to beat X" notes); they are not the quotable source. This
keeps "one approved-knowledge taxonomy" true and gives battlecards the committed seed + schema the brief asks
for. *(Alternative: keep the battlecard store fully separate with its own schema+seed — rejected as it
re-creates a second parallel quotable store, the exact thing §D-1 argues against.)*

### D-3. PII / purge — **RECOMMEND: no-PII-by-construction (abstraction), proven by a test** (not extend-purge)

Requirement A already mandates objections carry an **abstracted `pattern`**, and the battlecard guardrail is
*"differentiation, not assertion about the competitor."* So the new types should carry **no prospect identity
and no verbatim quotes by construction** — verbatim quotes + who-said-it stay in **account-memory**, which
`privacy-purge.js` already reaches. We enforce this with a schema/test that forbids identity fields in the
knowledge layer and prove an entry carries none. This is **lower-code, lower-risk, and strengthens the
firewall** (the layer simply never holds PII) versus extending purge to clean PII the layer ideally shouldn't
hold. *(Alternative: extend `privacy-purge.js` to cover the store — more code, and it concedes the store holds
identity. Rejected unless you want belt-and-suspenders.)*

---

## E. Recommended approach (Phases 1–5)

1. **ADR + schema + taxonomy.** Author the first product-store JSON Schema (mirror `state-store.schema.json`).
   Match the **live two-field provenance** (`source_title`+`source_url`). New `type` enum values
   `objection`/`pain`/`battlecard` and new **optional** tags `role`/`competitor` — all optional so the 20 live
   entries still validate. Reject the contradiction `approved:true` + `untrusted:true`. Reserve a
   **human-write-only, unwired** `resonance` slot (deferred).
2. **Candidate/approved wall (structural, per D-1).** Approved file + sibling `candidate/` path; drafters
   pointed only at approved; operator-only promotion mirroring the instinct lifecycle.
3. **Coded retrieval ladder** (`scripts/lib/product-knowledge.js`, mirror `account-memory.js`):
   role+segment+competitor → role+segment → segment → general, returning an explicit "no approved proof"
   sentinel; approval + freshness filtering; never throws. The single model the divergent prose copies
   converge onto.
4. **Controlled vocab + title→role map + role resolution.** One committed vocab file (validated by a
   disk-loading test): `roles` (start small), `segments` (formalize `enterprise`/`mid-market`/`smb`),
   `competitors`; plus a `jobtitle`→role map with explicit fallback (unknown → `general`, which still
   retrieves general proof). Wire role resolution at draft time via the existing HubSpot read tools through a
   read-capable agent (drafters have no HubSpot tools).
5. **Seed + purge + staleness + gap-log + CLI.** Re-tag clearly-role-specific live entries (general
   otherwise). Mine a small seed from calls/sent-mail **inside the quarantine/untrusted pattern**, emitting
   **candidates only** (`approved:false, untrusted:true`, `source_type: call|email`). PII via D-3
   (no-identity-by-construction + test). Shorter re-verify cadence for `battlecard`/`pain`. Gap-log every
   clean miss (role/segment/competitor/use-case). Operator CLI verbs `escc product add` / `escc product
   approve` (mirror the instinct approve/reject operator path). **Resonance + ongoing outcome loop deferred.**

---

## F. Contradictions with the brief (repo wins)

1. **Not "one store" today.** Two parallel runtime stores exist — product and a separate per-card battlecard
   store (`competitor-battlecards/SKILL.md:54`). Folding battlecards in is a design change (see D-2), not an
   extension of a unified store.
2. **Not one file even within product.** Product is a single flat array; there are no per-type files.
3. **No schema / no coded retrieval to extend.** The taxonomy is prose-only; type/field enforcement is
   net-new, not an extension.
4. **`source` is two fields on disk** (`source_title`+`source_url`), not the single `source` the skill names.
   The new schema must match the live shape.
5. **`proof-point` is defined-but-unused; the new types are greenfield** against this store.
6. **`jobtitle` is fixture-only** — role-at-draft is entirely new wiring.
7. **Store-path literals disagree with the resolver** — content plane hardcodes relative `.claude/escc/…`;
   the authority is `agent-data-home.js`. Must converge.
8. **Option (b) cannot "strip" rows** — the repo supports only path allow/block, so (b) presupposes (a).
9. **The "fabrication firewall" is two different things.** The coded gate-2 "claim-vs-record"
   (`scripts/lib/outbound-gates.js:248-278`) validates *prior-interaction* claims against CRM notes — it does
   **not** consult the product store. Product-proof grounding (cold-outreach Gate C) is **prose-only** today.
   The send-gate does not enforce product grounding.
10. **Consumer count ≈ double** the brief's ~16 (≈31–32; §C).

---

## G. Open questions / could-not-verify

- **[UNVERIFIED] Exact consumer total (≈31 vs 32).** The boundary between "retrieves" and "references" is
  judgment-dependent for a few operator/routing skills. Use ≈31–32 as the rewire set; map each explicitly in
  Phase 4.
- **[DECIDE AT PHASE 1] JSON-Schema dialect/`$id` style.** Provenance is draft-07; instinct/state-store are
  2020-12 with differing `$id` styles. `schemas.test.js` compiles `strict:false`, so either passes. Plan:
  store schema → mirror `state-store.schema.json` (2020-12, short dotted `$id`); vocab schema → match its
  neighbor.
- **[CARRY FORWARD] Mirror the vocab-enum *pattern*, not its values.** `provenance.schema.json:16`
  `source_type` enum is `[crm,email,web,user,inferred,document,call,manual]` — distinct from the skill's
  `case_study/internal_metric/public/customer_quote`. The new vocab mirrors the flat-string-enum *shape*, with
  its own role/competitor/segment values.
- **[CARRY FORWARD] Re-grep `^## ADR-` at authoring time** — `DECISIONS.md` is append-only and may gain
  entries before Phase 1 writes; ADR-0012 is correct as of this research (`docs/DECISIONS.md:231`).
- **Runtime store contents are gitignored** — the 20-entry facts come from a live runtime read, not committed
  files; not re-verifiable from the repo alone.
- **DEFERRED (explicit):** auto-inferred **resonance** and the **ongoing outcome-fed ingestion loop** are a
  separate, supervised follow-up. The `resonance` field, if added, is human-write-only and unwired in this
  task.
