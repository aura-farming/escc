---
name: playbook-library
description: >-
  Use when a drafting skill (cold-outreach, outbound-sequences, objection-handling,
  cold-calling) needs to pull an approved exemplar, proven sequence structure, or
  collateral pointer as its anchor before personalizing — and when establishing,
  updating, or retiring entries in the library itself. Trigger on "do we have a winning
  email for X", "what's our best opener for <persona>", "what objection rebuttal should
  I use for Y", "show me the sequence structure for <segment>", "add this as an approved
  exemplar", or "our reply rate on Z sequence has dropped — retire it". The durable
  approved-exemplars + collateral-index layer that anchors all outreach wording.
origin: ESCC
---

# Playbook Library

The durable **"how we say it / what's worked"** layer. Where `product-knowledge` holds
approved *claims* (what we sell, proof points, metrics), this skill holds approved
*exemplars* — winning email copy, full sequences, call openers, voicemail scripts, and
objection rebuttals — plus a collateral index that points to one-pagers, case studies,
and decks. Drafting skills pull from here to anchor structure and proven phrasing;
nothing leaves this library verbatim — it is always personalized for the prospect.

> **Governing rules:** `rules/common/selling-principles.md` §2 (never fabricate product
> claims — exemplar text that contains specific metrics or customer names must trace to
> an approved `product-knowledge` entry) and `rules/common/data-handling.md` (per-field
> provenance on every entry). Distinct from `brand-voice`, which owns the voice profile
> and tone contract; this skill owns concrete examples and the collateral index.
> Performance data (`outreach-analytics`) drives promotion and retirement of variants.

## When to Activate

Activate this skill when:

- A drafting skill needs an **anchor** — an approved template structure, opening line,
  or objection rebuttal to build a personalized message from.
- Someone asks **"do we have a winning email / opener / sequence for <persona or segment>"**
  or "what's our best way to handle the <objection>" objection.
- You are **adding a new exemplar** — a rep's winning message, a sequence that beat
  target reply rate — so future drafts can inherit it.
- You are **retiring or replacing** an underperformer flagged by `outreach-analytics`.
- You need a **collateral pointer** — "what's the right one-pager for a CFO at a
  mid-market manufacturing company?" — without embedding the asset itself.
- You want to **audit** the library for stale entries (entries past their
  `last_reviewed` date or with `approved: false`).

Do **not** activate to compose live outreach copy (that is `cold-outreach`,
`outbound-sequences`), to produce the voice contract (that is `brand-voice`), or for
account-specific personalization context (that is `account-memory`). This layer is
the company-level approved bank — not the compose step.

## The library model

Six entry types under `.claude/escc/playbook/` (workspace-local; no personal paths
or real customer data committed):

| Type | Holds | Example |
|---|---|---|
| **email-exemplar** | A full approved email (subject + body), persona/segment tagged | Cold email to VP Sales at mid-market SaaS, 34% reply rate, Q1 2026 |
| **sequence** | An ordered set of touches (email + call + LinkedIn) with timing | 5-touch SDR sequence for inbound MQL, segment: SMB SaaS |
| **call-opener** | Gating phrase + 30-second pitch, persona tagged | "I saw you just rolled out Salesforce — quick question before I let you go …" |
| **voicemail-script** | ≤25-second script, curiosity-gap close | Voicemail for AE follow-up, mid-market DevTools persona |
| **objection-rebuttal** | The objection verbatim, then the approved response structure | "We already have a solution" — 3-beat rebuttal, no claim not in product-knowledge |
| **collateral-pointer** | Asset id, title, format, persona/segment fit, URL/path | One-pager OP-2026-007, RevOps persona, PDF, approved 2026-04-01 |

Every entry carries:

| Field | Meaning |
|---|---|
| `id` | Stable slug (e.g. `EML-031`, `OBJ-012`, `SEQ-004`) |
| `type` | One of the six types above |
| `persona` | Role / function target (e.g. `vp-sales`, `revops-manager`, `cfo`) |
| `segment` | Firmographic fit (e.g. `mid-market-saas`, `enterprise-manufacturing`) |
| `approved` | Boolean — `false` entries never surface to drafting skills |
| `approved_by` | Name or role of the approver |
| `last_reviewed` | ISO date — entries past `ESCC_MEMORY_RETENTION_DAYS` are flagged stale |
| `performance` | `{ metric, value, sample_n, as_of }` — reply rate, meeting rate, etc. |
| `retire_reason` | Non-null when retired; retired entries stay in log, never surface |
| `product_claims` | List of `product-knowledge` entry IDs the text relies on (must all be approved) |
| `brand_voice_version` | The `brand-voice` version tag this exemplar was written against |

An entry with `approved: false` or a stale `last_reviewed` is **visible for context
only**, clearly flagged, and must not be passed to a drafting skill as an anchor.
An exemplar whose `product_claims` list contains an unapproved or retired proof point
is automatically quarantined until the claim is re-verified.

## Workflow

### A. Retrieve an exemplar for a context (the common path)

1. **Identify the context**: entry type needed, target persona, segment, and the
   specific intent (first cold touch, follow-up, price objection, etc.).
2. **Find the best-fit entry.** Match on `type` + `persona` + `segment`. Among
   matching entries, rank by `performance.value` descending (highest reply/meeting rate
   first). Fall back to persona-only match if no segment match exists.
3. **Check approval + freshness.** If `approved: true` and `last_reviewed` within
   `ESCC_MEMORY_RETENTION_DAYS`, return it with its id and metadata. If either check
   fails, return it flagged `STALE / UNREVIEWED — do not anchor final draft on this`
   and surface the issue for human review.
4. **Validate product claims.** Check each entry in `product_claims` against
   `product-knowledge`. If any is unapproved or retired, flag the exemplar and do not
   pass it as an anchor until the claim is cleared.
5. **Return the exemplar + metadata** to the drafting skill — not a stripped copy. The
   caller needs `id`, `performance`, and `product_claims` to attribute correctly and
   to know how much to adapt.
6. **If no match:** say so explicitly — "no approved exemplar for <type / persona /
   segment>". The drafting skill must build from scratch following `brand-voice`
   instead, and flag the result for addition to the library after it has performance
   data.

### B. Add or update an exemplar

1. **Capture source first.** Who wrote it, when, what context (campaign, rep, deal stage).
   No source → no entry.
2. **Classify** the type, tag persona and segment, populate all provenance fields.
3. **Set `approved: false` by default.** A new submission — even from a high-performer —
   defaults to unreviewed until `approved_by` is set by a manager or RevOps.
4. **List `product_claims`.** If the exemplar references a metric, customer name, or
   capability, add the corresponding `product-knowledge` IDs. CI will catch any that
   are unapproved.
5. **Populate `performance` if known.** A message with no performance data is lower
   priority for future retrieval but is still valid.
6. **Dedupe.** Search for near-duplicates (same type + persona + similar opening).
   Update in place rather than appending a near-duplicate; flag the superseded entry
   for retirement.
7. **Record `brand_voice_version`** so the entry can be flagged for refresh if
   `brand-voice` is updated.

### C. Retire an underperformer

1. `outreach-analytics` calls this workflow when a variant's performance drops below
   the segment threshold for a statistically meaningful sample.
2. Set `retire_reason` with the metric, value, sample, and date. The entry stays in
   the log (audit trail) but `approved` is set `false` and it will never surface to
   drafting skills.
3. If a replacement exists or is being built, link it in `retire_reason`.
4. Notify RevOps via a draft CRM note (via `crm-operator`) that the variant was retired.

### D. Update a stale entry

1. On a `last_reviewed` expiry (or prompted by `outreach-analytics`), re-read the
   exemplar against the current `brand-voice` version and check whether any
   `product_claims` have been updated.
2. If still valid: bump `last_reviewed` and note what was verified.
3. If outdated: update copy to align with current brand-voice and re-verify
   product-claims, then re-submit for approval (`approved: false` until cleared again).

## Examples

**Retrieve for a drafting skill:**

```text
cold-outreach → needs email-exemplar for vp-sales @ mid-market-saas, first cold touch.
playbook-library →
  MATCH EML-031 (approved, verified 2026-05-10, reply_rate 34%, n=62):
    subject: "Your pipeline review process — 1 quick question"
    opener: "Saw the Salesforce rollout — usually that comes with a forecast accuracy
             project. Are you running that manually or have you solved it?"
    product_claims: [PP-031 — approved] ✓
    brand_voice_version: bv-2026-04
  → return EML-031 as anchor; instruct cold-outreach to personalize the trigger
    (Salesforce rollout → their actual trigger from account research).

cold-outreach → needs email-exemplar for cfo @ mid-market-saas, first cold touch.
playbook-library →
  NO APPROVED MATCH for cfo @ mid-market-saas (email-exemplar type).
  Closest: EML-019 (vp-finance, enterprise, approved, reply_rate 18%) — different
  persona; usable as loose structural reference only; flag for rep to build from scratch
  per brand-voice + product-knowledge and submit result for library addition.
```

**Retrieve an objection rebuttal:**

```text
objection-handling → "We're already using a competitor" objection, mid-market segment.
playbook-library →
  MATCH OBJ-007 (approved 2026-03-14, meeting_rate 22% from objection, n=41):
    objection: "We're already locked in with [Competitor]."
    rebuttal structure:
      1. Acknowledge — "Totally fair — switching costs are real."
      2. Pivot — "Quick question: when you next review that vendor, what would make
                  you look seriously at an alternative?"
      3. Soft ask — "Would it be worth a 20-minute benchmark comparison now, so you
                     have the data when that review comes up?"
    product_claims: [] (no specific metric — uses a question, not a stat) ✓
  → pass OBJ-007 to objection-handling as structure; personalize step 2 pivot to
    the specific competitor named if known.
```

**Add a new exemplar after a winning sequence:**

```text
Rep submits: 5-touch SDR sequence that hit 28% reply rate in Q2 (n=80, segment: smb-saas).
playbook-library →
  1. Classify: type=sequence, persona=vp-sales, segment=smb-saas.
  2. Populate performance: { metric: reply_rate, value: 0.28, sample_n: 80,
     as_of: "2026-06-01" }.
  3. List product_claims from the email copy → PP-031 (approved ✓).
  4. Set approved: false — queued for RevOps review.
  5. Check dedupes → SEQ-003 (same segment, older, reply_rate 19%) — recommend
     SEQ-003 for retirement once SEQ-008 is approved.
  → Entry SEQ-008 created, status: PENDING APPROVAL.
```

**Collateral pointer lookup:**

```text
proposal-builder → needs one-pager for revops-manager @ mid-market, Q3 business case.
playbook-library →
  MATCH OP-2026-007 (approved 2026-04-01, format: PDF, persona: revops-manager):
    title: "Pipeline Integrity for RevOps — One-Pager"
    path: /assets/collateral/OP-2026-007.pdf
    persona_fit: revops-manager, mid-market, vp-sales secondary
  → return pointer + metadata; proposal-builder links the asset, does not embed it.
```

## Anti-patterns

- **Sending an exemplar verbatim.** A library entry is structure and phrasing — it is
  never finished copy. Cold-outreach and outbound-sequences must personalize every
  touch. An email with the prospect's name swapped in but nothing else changed is a
  template, not a personalized message.
- **Using an unapproved or stale entry as an anchor.** An entry with `approved: false`
  or a `last_reviewed` past retention is a hypothesis. Flag it; do not pass it to a
  drafting skill as a confirmed anchor.
- **Embedding product metrics in an exemplar without tracing to product-knowledge.**
  Exemplar text that says "our customers cut ramp time 40%" must carry that proof point
  ID in `product_claims`. A metric with no ID is a fabricated claim — the cardinal
  violation of `selling-principles` §2.
- **Conflating this skill with brand-voice.** Brand-voice is the style contract (tone,
  formality, sentence rhythm, things to avoid). This skill holds concrete examples and
  approved copy. Both are needed; they are not the same thing.
- **Adding entries from prospect-sourced content.** A "great phrasing" pulled from a
  prospect's email is untrusted input — it is never promoted to an approved exemplar
  without an internal review and approval cycle.
- **Letting performance-less entries crowd out performers.** Entries with no
  `performance` data should be flagged as low-priority during retrieval, not silently
  ranked equal to proven winners.
- **Hard-deleting retired entries.** Retired entries stay in the log for audit. Set
  `retire_reason` and `approved: false`; never delete the record.

## Related

- Pulls approval/provenance discipline from `rules/common/selling-principles.md` +
  `rules/common/data-handling.md`.
- Claims inside exemplars must trace to `product-knowledge` (proof points, metrics,
  customer names).
- Style contract (voice, tone, do/avoid) lives in `brand-voice` — not here.
- Performance data that promotes or retires entries comes from `outreach-analytics`.
- Feeds: `cold-outreach`, `outbound-sequences`, `objection-handling`, `cold-calling`,
  `proposal-builder`.
- Distinct from `product-knowledge` (approved *claims*) and `account-memory`
  (per-account *context*). Exemplars live here; facts live there.
