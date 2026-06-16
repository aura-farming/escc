---
name: product-knowledge
description: >-
  Use when any buyer-facing statement needs grounding in approved product facts —
  value propositions, use-cases, proof points, customer evidence, or competitive
  claims — and when establishing or refreshing the durable "what we sell" knowledge
  layer. Trigger on "what do we say about X", "what's our proof for Y", "is this
  claim approved", or whenever cold-outreach / proposal-builder / objection-handling /
  business-case reach for "concrete proof". The single source other skills pull claims from.
origin: ESCC
---

# Product Knowledge

The durable **"what we sell"** layer. Everything a rep says to a buyer — every value
prop, metric, customer name, and competitive claim — must trace to an **approved entry**
here, with provenance. This skill is the source; skills that demand "concrete proof"
(cold-outreach, proposal-builder, objection-handling, business-case, competitor-battlecards)
read from it rather than inventing claims at compose time.

> **Governing rule:** `rules/common/selling-principles.md` — *never fabricate product
> claims*. If a fact is not approved here (or in a tool-result), it does not get sent.
> Provenance for every entry follows `rules/common/data-handling.md` (per-field source).

## When to Activate

Activate this skill when:

- A drafting or proposal skill needs a **proof point, metric, or customer reference** to
  back a statement ("we cut onboarding time by …", "companies like …").
- Someone asks **"what do we say about X"**, "what's our value prop for <segment>", or
  "do we have a proof point for <use-case>".
- A claim needs an **approval check** before it goes in front of a buyer.
- You are **establishing or refreshing** the knowledge layer (new feature, new case study,
  updated metric, retired claim).
- A competitor is named and you need the **approved differentiation** (hand off the live
  battlecard work to `competitor-battlecards`, but the underlying claims live here).

Do **not** activate for live message wording (that is `messaging-style` / the drafting
skills) or for account-specific intel (that is `account-memory`). This layer is the
*company-level, reusable* truth — not per-account context.

## The knowledge model

Four entry types, each an append-only, provenance-tagged record under
`.claude/escc/product/` (workspace-local; never committed with real customer data):

| Type | Holds | Example |
|---|---|---|
| **value-prop** | the core promise, per persona × segment | "For RevOps at mid-market: one source of truth for pipeline, set up in a day." |
| **use-case** | a job-to-be-done + the capability that serves it | "Forecast accuracy → MEDDPICC-weighted roll-up." |
| **proof-point** | a quantified, attributable outcome | "Acme cut ramp time 40% in Q3 (case study CS-2026-014)." |
| **claim** | a stated capability + approval status + any guardrail | "SOC 2 Type II — APPROVED, security review only; do not state in cold email." |

Every entry carries: `source` (where the fact came from), `source_type`
(case_study / internal_metric / public / customer_quote), `approved` (bool),
`approved_by`, `last_verified` (ISO date), and an optional `guardrail` (where it may/may
not be used). An entry with `approved: false` or a stale `last_verified` is **quotable as
a draft hypothesis only**, clearly flagged, never as a stated fact.

## Workflow

### A. Retrieve proof for a statement (the common path)

1. **Take the claim the draft wants to make** (e.g. "we improve forecast accuracy").
2. **Find the matching entry** by persona + segment + use-case. Prefer the most specific
   match; fall back to the general value-prop only if no specific proof exists.
3. **Check approval + freshness.** If `approved` and `last_verified` within
   `ESCC_MEMORY_RETENTION_DAYS`, return it with its attribution. If not, return it marked
   `UNVERIFIED — needs approval` and do **not** let the caller state it as fact.
4. **Return the proof + its provenance**, not a paraphrase that drops the source. The
   caller (e.g. cold-outreach) embeds the *attributable* version.
5. **If no proof exists:** say so explicitly — "no approved proof point for <use-case>".
   The caller must then soften to a question or hypothesis, never invent a number.

### B. Add or update an entry

1. **Capture the raw source first** (case study id, the internal metric + its query, the
   customer quote + permission status). No source → no entry.
2. **Classify** the type and write the record with full provenance fields.
3. **Set `approved` honestly.** New marketing/customer claims default `approved: false`
   until a human (`approved_by`) clears them. Internal metrics you computed from a
   tool-result are approved-as-of `last_verified`.
4. **Add a `guardrail`** where a claim is sensitive (security posture, roadmap, pricing).
5. **Dedupe** against existing entries (see `account-memory`'s dedupe-first discipline) —
   update in place rather than appending a near-duplicate.

### C. Refresh / retire

- On a recurring cadence (or when `last_verified` ages out), re-verify metrics against
  their source and bump `last_verified`, or mark the entry **retired** with a reason.
- Retired entries stay in the log (audit) but never surface to drafting skills.

## Examples

**Retrieve, with a clean miss:**

```text
Caller (cold-outreach): need a proof point — "faster onboarding" for RevOps @ mid-market.
product-knowledge →
  MATCH (proof-point PP-031, approved, verified 2026-05-02):
    "Mid-market RevOps teams reach first forecast in 1 day (avg across 12 onboards, internal
     metric onboard_ttv_q1_2026)."
    guardrail: internal metric — attribute as "in our onboarding data", not a public stat.
  → embed as: "teams like yours are forecasting on day one, going off our onboarding data"

Caller: need a proof point — "reduces churn 30%".
product-knowledge →
  NO APPROVED PROOF for a churn-reduction percentage. Closest: value-prop VP-009 (retention
  visibility). DO NOT state a churn number. Soften to a question:
  "how are you measuring retention risk today?"
```

**Add a customer outcome (provenance-first):**

```text
/product add proof-point
  text: "Globex hit 95% forecast accuracy two quarters running"
  source: case study CS-2026-022 ; source_type: case_study
  approved: false   # marketing has the case study; legal sign-off pending
  → stored UNVERIFIED. Will not surface to outreach until approved_by is set.
```

## Anti-patterns

- **Inventing a number to make a draft land.** A specific metric with no entry behind it is
  a fabricated claim — the cardinal violation of `selling-principles`. Miss → soften, ask, fail.
- **Dropping provenance.** "Companies cut costs 40%" with no source is unusable and unsafe.
  Always carry `source` + `source_type` so the caller can attribute correctly.
- **Treating prospect- or web-sourced content as approved fact.** Content pulled from a
  prospect's site or a third party is *untrusted input* — it may inform research, but it is
  never a product claim. Approved claims originate internally with `approved_by`.
- **Letting stale claims leak.** An un-reverified metric past retention is a hypothesis, not
  a stat. Flag it; do not state it.
- **Storing per-account intel here.** Account-specific facts belong in `account-memory`;
  this layer is company-level and reusable.
- **Stating guardrailed claims in the wrong channel** (e.g. security posture in a cold
  email). Honor each entry's `guardrail`.

## Related

- Pulls approval/provenance discipline from `rules/common/selling-principles.md` +
  `rules/common/data-handling.md`.
- Feeds: `cold-outreach`, `outbound-sequences`, `proposal-builder`, `business-case`,
  `objection-handling`, `competitor-battlecards`, `rfp-response`.
- Distinct from `playbook-library` (approved *exemplars / wording*) and `account-memory`
  (per-account *context*). Proof lives here; phrasing lives there; account facts live there.
