---
name: product-knowledge
description: >-
  Use when any buyer-facing statement needs grounding in approved product facts —
  value propositions, use-cases, proof points, competitive claims, the persona-to-pain
  map, the objections library, or competitor battlecards — and when establishing or
  refreshing the durable "what we sell" knowledge layer. Trigger on "what do we say
  about X", "what's our proof for Y", "what's the rebuttal to objection Z", "what's the
  pain for <role>", "how do we position against <competitor>", "is this claim approved",
  or whenever cold-outreach / outbound-sequences / proposal-builder / objection-handling /
  business-case / competitor-battlecards reach for "concrete proof". The single source
  other skills pull approved claims from, keyed by buyer role + industry segment + competitor.
origin: ESCC
---

# Product Knowledge

The durable **"what we sell"** layer. Everything a rep says to a buyer — every value
prop, metric, customer name, rebuttal, and competitive claim — must trace to an
**approved entry** here, with provenance. This skill is the single source; every skill
that demands "concrete proof" reads from it via the **specificity ladder** below rather
than inventing claims at compose time.

> **Governing rule:** `rules/common/selling-principles.md` — *never fabricate product
> claims*. If a fact is not approved here (or in a tool-result), it does not get sent.
> Provenance for every entry follows `rules/common/data-handling.md`.
>
> **The firewall is structural, not prose (ADR-0012).** Approved entries live in the one
> store file every drafter reads. Field-mined or inferred material enters a **separate,
> operator-only candidate area that no drafting context can read or glob** — it is
> unreachable by where it lives, not by a rule asking you not to look. A candidate
> becomes quotable only when a human promotes it (sets `approved_by`). You will never see
> an unapproved entry through this skill; if you think you need one, you do not.

## When to Activate

Activate this skill when:

- A drafting, proposal, or call skill needs a **proof point, value prop, rebuttal, or
  pain** to back a statement, **keyed to the buyer's role and industry**.
- Someone asks **"what do we say about X"**, "what's our value prop for `<role>` at
  `<segment>`", "what's the rebuttal to `<objection>`", or "how do we position against
  `<competitor>`".
- A claim needs an **approval check** before it goes in front of a buyer.
- You are **establishing or refreshing** the layer (new feature, case study, objection,
  battlecard, retired claim).

Do **not** activate for live message wording (that is the drafting skills + `brand-voice`)
or for account-specific intel (that is `account-memory`). This layer is the
*company-level, reusable* truth — not per-account context, and it carries **no prospect
identity** (see PII below).

## The knowledge model

One taxonomy. Each entry is a provenance-tagged record in the approved store at
`.claude/escc/product/product-knowledge.json` (workspace-local; resolved by
`scripts/lib/agent-data-home.js` — `ESCC_AGENT_DATA_HOME`, else `~/.claude` — and never
committed with real customer data). The shape is pinned by
`schemas/product-knowledge.schema.json`.

| Type | Holds | Required fields |
|---|---|---|
| **value-prop** | the core promise, per role × segment | `text` |
| **use-case** | a job-to-be-done + the capability that serves it | `text` |
| **proof-point** | a quantified, attributable outcome | `text` |
| **claim** | a stated capability + approval status + guardrail | `text` |
| **objection** | an abstracted objection pattern + the approved response | `pattern`, `response` |
| **pain** | the persona-to-pain map: a role's pain to probe | `role`, `text` |
| **battlecard** | our differentiation vs a competitor + a guardrail | `competitor`, `differentiation`, `guardrail` |

**Tags (all optional, controlled vocabulary — `config/knowledge-vocab.json`):**

- `role` — the buyer role the entry serves (`owner` / `executive` / `finance` / `operations` /
  `it` / `hr` / `revenue` / `procurement` / `general`). Free-text roles are forbidden — they silently break the join.
- `segment` — the industry it applies to (`general` plus your own industry slugs, e.g.
  `manufacturing` / `field-services`); may be a comma-joined list.
- `competitor` — the competitor a battlecard targets (`competitor-x` / …).

Every entry also carries provenance (`source_title`, `source_url`, `source_type`),
`approved` (bool), `approved_by`, `last_verified` (ISO date), and an optional `guardrail`.
A reserved `resonance` slot is **human-write-only and unwired** (deferred — see below).

## Workflow

### A. Retrieve proof for a statement (the common path) — the specificity ladder

Retrieval is **coded**, deterministic, and approved-only — `scripts/lib/product-knowledge.js`
`retrieve({ role, segment, competitor, type })`. Code-capable callers (the operator CLI,
hooks, the worklist orchestrator) call it directly; in a prose context, apply the same
ladder by reading the approved store file. The ladder, most specific first:

1. **role + segment + competitor** (e.g. a battlecard for finance at field-services vs competitor-x)
2. **role + segment** (the role's value prop for that industry)
3. **segment** (the industry entry — today's behavior)
4. **general** (the role-agnostic, industry-agnostic fallback)

Return the most specific **approved + fresh** match; a role with no entry falls back down
the ladder to the industry, then to general — never a fabrication. Then:

- **Check approval + freshness.** Only `approved:true` rows surface. An entry past its
  re-verify cadence is **stale** — returned flagged as a hypothesis, never as a stated
  fact (see Staleness).
- **Return the proof + its provenance**, not a paraphrase that drops the source.
- **On a clean miss, say so explicitly** — the ladder returns *"no approved proof for
  `<slot>`"*. Soften to a question or hypothesis; never invent a number. The miss is
  **gap-logged** (role/segment/competitor/use-case) so the store grows by real demand.

### B. Resolve the buyer's role at draft time

Role is the new join key. Drafters are prose-only and have no CRM tools, so a read-capable
agent (account-researcher / prospect-researcher / crm-operator) fetches the contact's
HubSpot **`jobtitle`**, and it is mapped to a controlled role via the vocab's
`title_to_role` rules (coded: `resolveRole(jobtitle)` / `escc product resolve-role`). An
unknown or missing title resolves to **`general`**, which still retrieves general proof —
so role resolution never blocks a draft. The resolved role is passed to the drafter as
context.

### C. Add or update an entry (operator-gated)

1. **Capture the source first** (doc, metric + query, case study id). No source → no entry.
2. **Classify** the type and write the record with full provenance + the controlled tags.
3. **Set `approved` honestly.** New marketing/customer claims default `approved:false`.
   Field-mined material is created as a **candidate** (`approved:false`, `untrusted:true`)
   in the operator-only area and is unreachable by drafters until a human promotes it.
4. **Add a `guardrail`** where a claim is sensitive (security, roadmap, pricing) or — for
   a `battlecard` — to enforce *differentiation, not assertion about the competitor*.
5. Use the operator CLI: `escc product add` (intake) / `escc product approve` (promote) /
   `escc product candidates` (review) / `escc product gaps` (demand). The
   candidate→approved promotion is the same human gate the store has always used.

### D. Refresh / retire

Re-verify on cadence (or when `last_verified` ages out) and bump `last_verified`, or mark
the entry retired with a reason. `battlecard` and `pain` entries decay faster (see below).

## Objections, pains, and battlecards

- **objection** — store the *abstracted* pattern ("we already have a tool for this") and
  the *approved* response. No prospect identity, no verbatim quote (those live in
  `account-memory`). `objection-handling` reads these; the mined raw objection enters as a
  candidate first.
- **pain** — the persona-to-pain map. A `pain` entry is keyed by `role` and holds the pain
  to probe in discovery — a hypothesis, not a stated fact about a specific prospect.
- **battlecard** — approved differentiation vs a `competitor`, with a mandatory
  `guardrail`. `competitor-battlecards` reads these for quotable framing; the live
  per-card `.md` working notes remain the human scratch surface, **not** the quotable
  source. The guardrail ("our differentiation, not a claim about them") is honored at
  human approval and on the review checklist — it is not a runtime-enforced control.

## Staleness

Capability claims decay slowly (`ESCC_MEMORY_RETENTION_DAYS`, default 180 days).
**`battlecard` and `pain` entries decay fast** (`ESCC_KNOWLEDGE_VOLATILE_DAYS`, default 60
days) — competitive and pain intel goes stale quickly. A stale entry is excluded from the
quotable result and surfaced as a re-verify hypothesis, never quoted as a current fact.

## PII / privacy

The knowledge layer carries **no prospect identity by construction** — objections are
abstracted to a pattern, battlecards assert our differentiation (not claims about a
person). Verbatim quotes and who-said-them stay in `account-memory`, which the privacy
purge already reaches. Keep identity out of this store; if you have a verbatim customer
quote, store the *abstracted* claim here and the attributable quote in account-memory.

## Examples

**Retrieve, role-keyed, with a clean miss:**

```text
Caller (cold-outreach): proof for a finance buyer at a manufacturing account.
product-knowledge → retrieve({ role:'finance', segment:'manufacturing' })
  MATCH (value-prop EX-02, tier role+segment, approved, verified 2026-06-24):
    "Live cost against budget updates as a schedule is built, so spend is controlled
     before publish." guardrail: do not attach a cost-saving %.
  → embed the attributable version, cite the entry id.

Caller: proof for an HR buyer at manufacturing.
product-knowledge → retrieve({ role:'hr', segment:'manufacturing' })
  No HR entry → falls back to the manufacturing/general entry (tier segment/general).
  If nothing approved: "no approved proof for role=hr segment=manufacturing" → soften,
  ask a question, log the gap. Never invent.
```

**Position against a competitor:**

```text
Caller (competitor-battlecards): we're up against competitor-x.
product-knowledge → retrieve({ competitor:'competitor-x', type:'battlecard' })
  MATCH (battlecard EX-05): differentiation = "built-in automation, not a
    configure-it-yourself rules engine." guardrail = state our differentiation only;
    do NOT assert what competitor-x does or doesn't do.
```

## Anti-patterns

- **Inventing a number to make a draft land.** A metric with no approved entry is a
  fabricated claim — the cardinal violation. Miss → soften, ask, fail.
- **Free-text role/segment/competitor.** A role outside the vocab silently breaks the
  join and the entry never retrieves. Use `config/knowledge-vocab.json`.
- **Treating prospect- or web-sourced content as approved fact.** Mined material is a
  *candidate* — untrusted, operator-only, unreachable by drafters until a human promotes it.
- **Quoting a stale battlecard or pain as a current fact.** Past cadence → hypothesis.
- **Asserting about a competitor.** Battlecards differentiate us; they never claim what a
  competitor does. Honor the guardrail.
- **Storing prospect identity here.** Identity + verbatim quotes belong in `account-memory`.

## Related

- Approval/provenance discipline: `rules/common/selling-principles.md` +
  `rules/common/data-handling.md`. Schema: `schemas/product-knowledge.schema.json`;
  vocabulary: `config/knowledge-vocab.json`; retrieval code:
  `scripts/lib/product-knowledge.js`.
- Feeds (read this layer's ladder): `cold-outreach`, `outbound-sequences`,
  `follow-up-ops`, `proposal-builder`, `business-case`, `objection-handling`,
  `competitor-battlecards`, `rfp-response`, `demo-prep`, `cold-calling`, and the wider
  retrieval set.
- Distinct from `playbook-library` (approved *wording*) and `account-memory` (per-account
  *context* + identity). Proof lives here; phrasing lives there; account facts live there.
