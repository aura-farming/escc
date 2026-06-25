---
name: proposal-builder
description: >-
  Use when it is time to turn a qualified deal into a structured written proposal
  or business case document — trigger on "write the proposal", "build the deck",
  "put together our business case", or "draft the proposal for <account>". Also
  activate when a rep asks to tailor social proof / customer references to a
  persona or segment, match proof points to stated decision criteria, or assemble
  a role-specific leave-behind. The proposal-writer agent renders long form;
  this skill governs structure, proof-sourcing, and section logic.
origin: ESCC
---

# Proposal Builder

Turns deal context into a structured, buyer-centric proposal — section by section,
proof point by proof point. Every claim traces to an approved entry in
`product-knowledge`; pricing and packaging are deferred to `quote-desk`; ROI math
lives in `business-case`. This skill owns the architecture of the document and the
discipline of proof-matching.

> **Governing rules:** `rules/common/selling-principles.md` (never fabricate
> claims); `rules/meddpicc/qualification.md` (structure the proposal around
> discovered pain I and decision criteria D). All buyer-facing claims come from
> `product-knowledge` approved entries only.

## When to Activate

Activate this skill when:

- A deal has reached a stage where a written proposal or formal business case is
  the agreed next step, and the rep needs to assemble it.
- Someone asks to "draft the proposal", "write up the business case document",
  "put together a leave-behind", or "create a tailored pitch deck narrative" for
  a named account.
- Proof points need to be matched to a buyer persona, segment, or use-case before
  they go into a proposal ("which customers do we reference for <use-case>?").
- A proposal already drafted needs a section-by-section review to confirm every
  claim is grounded and every section addresses the buyer's stated criteria.

Do **not** activate for:

- **Live pricing or packaging** -- those belong in `quote-desk`. Reference value;
  never invent a price or discount in a proposal section.
- **Full ROI model / payback math** -- that lives in `business-case`, which can be
  embedded as a section inside the proposal but must run its own workflow first.
- **Mutual action plan / paper process** -- those are separate skills that attach
  as appendices, not proposal narrative.
- **Discovery or qualification** -- the deal must already have enough MEDDPICC
  coverage (at minimum: I, D, E identified) before a proposal is worth building.

## Workflow

### Step 1 — Confirm MEDDPICC readiness

Before writing a single word:

1. Pull the deal's current MEDDPICC state from the CRM record (or from the most
   recent `deal-review` output).
2. Confirm that at minimum:
   - **I (Pain)** is captured with a specific, buyer-stated problem and its
     business consequence (cost, risk, missed target).
   - **D (Decision criteria)** is known -- at least the buyer's top three
     evaluation criteria, ideally from a direct conversation or written brief.
   - **E (Economic buyer)** is identified by name and title.
3. If any of the three are gaps (red in `deal-review`), surface the gap and stop:
   "Cannot build a grounded proposal -- <element> is unknown. Suggested next step:
   [probe]." Do not write a proposal for an unqualified deal.
4. Note the segment (enterprise / mid-market / SMB) -- segment overlays
   (`rules/segments/<segment>.md`) adjust proof-point selection and tone.

### Step 2 — Pull and match proof points

1. For each decision criterion the buyer has stated, call `product-knowledge` to
   retrieve approved proof via its specificity ladder — **role + segment + competitor**,
   falling back to role+segment, then segment, then general (the economic buyer's role
   resolves from their `jobtitle`; unknown -> general):
   - Prefer a `proof-point` entry over a generic `value-prop`.
   - If `product-knowledge` returns "no approved proof for <use-case>", record
     the gap. **Do not invent a number or customer name.** In the proposal section,
     soften to a question or directional statement: "Many teams ask us about X --
     we can walk you through our approach on a technical call."
2. Check each entry's `guardrail`. Do not include a security posture, roadmap
   claim, or pricing-adjacent metric in a proposal section if the guardrail
   prohibits it without a security/legal review.
3. Collect the matched proof set: a table of [criterion, proof entry id,
   approved customer name or anonymized, metric, guardrail status].

### Step 3 — Match proof to buying committee roles

1. Use `stakeholder-mapping` to identify which sections of the proposal each
   buying-committee role will read most closely:
   - Economic buyer reads the executive summary and ROI section.
   - Technical evaluator reads the architecture / integration / security section.
   - End-user champion reads the workflow / day-in-the-life section.
   - Procurement reads commercial terms (defer that section to `quote-desk` /
     `paper-process`).
2. Assign proof points to the section where the most relevant reader will
   encounter them. A CFO does not need a feature comparison; they need a
   payback number from `business-case`.

### Step 4 — Draft the proposal structure

Assemble sections in this order (omit irrelevant sections; do not pad):

1. **Executive summary** (1 page maximum) -- buyer's stated pain (I), consequence
   of inaction, how the proposed solution addresses it, headline outcome if known
   from `business-case`.
2. **Why now** -- the compelling event or deadline that gives urgency to acting.
   Use the buyer's words from discovery if available; do not manufacture urgency.
3. **How we address your criteria** -- one subsection per decision criterion (D),
   each grounded with the matched proof point from Step 2.
4. **Customer outcomes** (social proof) -- 2-3 relevant approved references from
   `product-knowledge`, matched to the buyer's industry/role/use-case. Include
   attributable metrics; do not use unapproved customer names.
5. **ROI summary** (embed output from `business-case`) -- if the ROI model has
   been run, paste the summary table here. If it has not been run, mark this
   section as a placeholder: "We will complete a joint value model in our next
   working session."
6. **Recommended solution** -- capabilities that address the stated use-cases.
   No pricing here. Reference `quote-desk` for commercial terms.
7. **Next steps** (optional) -- high-level; the detailed mutual action plan lives
   in `mutual-action-plan`.

### Step 5 — Draft each section

For each section:

1. Lead with the buyer's language (use their words from discovery notes where
   available; this is untrusted input for factual claims but fine for tone/phrasing).
2. State the relevant proof point with attribution: the approved metric, the
   customer name (if the entry permits use), and the source type.
3. Tie back to the specific decision criterion the section addresses.
4. If a section would require fabricating a claim to be complete, leave a
   [PLACEHOLDER: needs approved proof for <use-case>] marker. The
   proposal-writer agent will render the section; the placeholder tells the rep
   where to go back to `product-knowledge`.

### Step 6 — Review before sending to proposal-writer

Before handing off for long-form render:

- Confirm every proof point has `approved: true` and a valid `last_verified` date.
- Confirm no section includes a price, discount %, or packaging detail (those are
  placeholders for `quote-desk`).
- Confirm the executive summary opens with the buyer's stated pain, not a product
  pitch.
- Confirm proof-point guardrails are honored (no security posture in an
  uncleared section, no roadmap items presented as current capability).

## Examples

**Full proposal structure (well-qualified deal):**

```text
Deal: Contoso Corp, mid-market, VP of Sales Economic buyer, discovery complete.
  Pain (I): "Our forecast is wrong every quarter -- we revise it 3x before close."
  Decision criteria (D): 1) native CRM integration, 2) quick rollout (<30 days),
    3) rep adoption without heavy training.

proposal-builder:

Step 1 check: I confirmed (forecast accuracy / quarterly re-work), D confirmed (3
  explicit criteria), E confirmed (VP Sales named). Segment: mid-market. Proceed.

Step 2 proof pull from product-knowledge:
  Criterion 1 "native CRM integration" -> PP-018 (mid-market, RevOps):
    "1-click HubSpot sync; no middleware" -- approved, guardrail: none.
  Criterion 2 "rollout <30 days" -> PP-031:
    "Median time-to-first-forecast: 1 day (12 onboards, Q1-2026 internal data)"
    guardrail: attribute as "onboarding data", not public stat.
  Criterion 3 "rep adoption" -> PP-044:
    "87% rep adoption at week 4 in a 200-seat deployment (anonymized)" -- approved.

Step 3 role mapping:
  VP Sales -> executive summary + ROI section (needs business-case output).
  RevOps   -> "How we address your criteria" section (integration depth).
  IT       -> security/integration section (defer sensitive claims to sec review).

Proposal structure output:
  1. Executive summary: "Forecasts revised 3x/quarter create noise at board level;
     we help mid-market sales orgs reach a single-pass forecast in their first week."
  2. Why now: "Your H2 planning cycle opens in 6 weeks -- a 30-day rollout means
     you enter H2 forecasting with a clean baseline."
  3. Criteria coverage: [3 subsections, one per criterion, proof points embedded]
  4. Customer outcomes: PP-031 + PP-044 + VP-009 (retention visibility, approved).
  5. ROI summary: [PLACEHOLDER -- run business-case skill first; attach output here]
  6. Recommended solution: capabilities list (no pricing -- defer to quote-desk).
  7. Next steps: [mutual-action-plan to be attached]
```

**Proof gap -- no fabrication:**

```text
Buyer criterion: "Do you integrate with SAP ERP?"

product-knowledge query: no approved proof point or capability entry for SAP ERP
  integration.

proposal-builder output for that section:
  "ERP connectivity is on our roadmap -- we would want to walk through the specific
  data flows you need before including a statement here. We will confirm scope with
  our solutions team and add a crisp answer before you share this with procurement."
  [PLACEHOLDER: needs approved integration claim for SAP ERP -- check with SE]

  Do NOT write: "We integrate natively with SAP." -- no approved entry exists.
```

**Segment overlay in action (enterprise):**

```text
Segment: enterprise. rules/segments/enterprise.md overlay applies:
  - References require named customer (not anonymized) where the entry permits.
  - Security posture section required -- but defer claim to approved security review
    (guardrail on relevant entries).
  - Procurement section required -- hand off to quote-desk + paper-process skills.
```

## Anti-patterns

- **Writing the proposal before qualifying the deal.** A proposal built without
  confirmed I and D is a brochure, not a proposal. Stop and probe first.
- **Inventing proof to fill a section gap.** A missing proof point is a gap, not a
  license to invent a number or a customer name. Leave the placeholder; go find
  the approved entry.
- **Including pricing in the narrative.** The proposal body states value, not price.
  Pricing belongs in the commercial schedule produced by `quote-desk`. Mixing them
  anchors the wrong conversation.
- **Pitching features instead of criteria.** Every section should map to a stated
  decision criterion (D). A section that exists only to show the product without
  mapping to a criterion is padding that undermines the buyer's trust.
- **Using discovery quotes as product claims.** Buyer language from discovery
  calls is useful for tone -- it is not a product claim. Their words describe their
  pain; approved product-knowledge entries describe your solution.
- **Skipping the guardrail check.** A security posture or roadmap claim that is
  approved for internal use but not for unreviewed externals will create a legal
  exposure the moment the proposal leaves the building.
- **Building a proposal for every deal.** Proposals are for qualified, advanced-
  stage deals. Early-stage "interest" conversations warrant a one-pager, not a
  full proposal. Qualify first; write second.

## Related

- `product-knowledge` -- the source for every approved proof point, customer
  reference, and capability claim used in the proposal.
- `business-case` -- owns the ROI / value model that embeds as a section.
- `quote-desk` -- owns pricing, packaging, and discount math (never in this skill).
- `stakeholder-mapping` -- maps buying-committee roles to proposal sections.
- `mutual-action-plan` -- the next-steps appendix; separate skill, not embedded here.
- `paper-process` -- commercial / procurement appendix; separate skill.
- `deal-review` -- validates MEDDPICC coverage before the proposal is started.
- `rules/meddpicc/qualification.md` -- the qualification model this skill gates on.
- `rules/common/selling-principles.md` -- the evidence-first, no-fabrication baseline.
- `rules/segments/` -- overlay adjustments for enterprise / mid-market / SMB tone
  and proof standards.
