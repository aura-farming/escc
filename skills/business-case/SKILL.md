---
name: business-case
description: >-
  Quantified ROI / value model for a deal from buyer-stated metrics + approved
  proof. Trigger: 'business case', 'ROI', 'payback', 'justify the investment'.
  Value math only — pricing = quote-desk.
origin: ESCC
---

# Business Case

The ROI and value-engineering model for a deal. Takes the buyer's own numbers
(MEDDPICC M: the quantified pain they have described) and pairs them with approved
benchmark data from `product-knowledge` to produce a current-state / proposed-state
comparison and a payback / ROI frame. Every input in the model is sourced -- either
buyer-stated or from an approved entry. If a number is missing, the model records
the gap rather than assuming a benchmark the buyer has not validated.

> **Governing rules:** `rules/common/selling-principles.md` (never fabricate
> claims; no invented benchmarks); `rules/meddpicc/qualification.md` (M evidence is
> the input; the deal-review M score gates whether a business case can be built
> rigorously); `rules/meddpicc/deal-review.md` (M scoring discipline).

## When to Activate

Activate this skill when:

- An economic buyer or champion explicitly asks for ROI, payback period, total cost
  of ownership comparison, or "the numbers" behind the recommendation.
- `proposal-builder` calls for the ROI section and the model has not been run yet.
- A deal is at or approaching evaluation / business-review stage and the champion
  needs a financial justification to present to the economic buyer internally.
- The rep wants to pressure-test MEDDPICC M before a forecast call: "Is the pain
  actually quantified, or are we guessing?"

Do **not** activate when:

- The buyer's M is not captured (red in MEDDPICC) -- the model cannot be built
  rigorously without it. Stop, note the gap, and probe for a number first.
- Pricing, discount, or packaging is the question -- that is `quote-desk`. This
  skill models value delivered; `quote-desk` models price charged.
- The only "metric" available is a benchmark the rep wants to borrow from a
  different industry or segment without the buyer validating it. Use only
  buyer-validated or approved-proof inputs.

## The value model structure

A business case has five components:

| Component | What goes here | Source requirement |
|---|---|---|
| **Current-state cost** | The buyer's baseline: what the problem costs them now (time, revenue, risk, headcount) | Buyer-stated (direct quote or CRM record) |
| **Proposed-state outcome** | The improvement they would achieve with the solution | Approved proof point from product-knowledge (with guardrail check) OR buyer hypothesis (clearly flagged as unvalidated) |
| **Delta** | Proposed minus current = value delivered | Derived from the two rows above |
| **Payback** | Time to recover the investment (investment / annualized delta) | Investment figure from quote-desk; delta from above |
| **3-year ROI** | ((3-year delta - total investment) / total investment) x 100 | Same sourcing discipline |

## Workflow

### Step 1 -- Confirm M evidence exists

1. Pull the deal's MEDDPICC M from the CRM or from the latest `deal-review` output.
2. M is "known" only when there is a specific number the buyer stated:
   - A dollar cost ("we lose $200K/quarter to manual re-forecasting").
   - A time cost ("three people spend two days each on this before every board").
   - A rate / miss ("our forecast accuracy is 60%; we need 85% to hit quota").
3. If M is amber (general statement without a number) or red (no metric at all):
   - Do not fill in an assumed benchmark. Record the gap:
     "M is amber -- buyer has described pain qualitatively but has not quantified
     it. Before running the business case, probe: 'What does that cost you per
     quarter in <time / revenue / rework>?'"
   - Pause the workflow. Do not produce a model with invented inputs.

### Step 2 -- Build the current-state cost line

1. From the buyer-stated M evidence, identify every cost bucket the pain generates:
   - Direct costs: staff time, tooling, rework, error correction.
   - Opportunity costs: deals missed, revenue not captured, targets not hit.
   - Risk costs: audit exposure, compliance gaps, reputational items (where the
     buyer has stated these -- never invent a risk category).
2. Express each bucket as an annualized number. Show the arithmetic openly:
   "3 analysts x 2 days/month x 12 months x $<buyer-stated hourly rate> = $X/year."
3. Label each number with its source: `buyer-stated (discovery call <date>)` or
   `buyer-confirmed in email <date>`. A number with no attribution is not usable.
4. Sum the current-state cost. This is the "problem worth solving" line.

### Step 3 -- Build the proposed-state outcome line

1. For each cost bucket identified in Step 2, query `product-knowledge` for approved
   proof via its specificity ladder — **role + segment + competitor**, falling back to
   role+segment, then segment, then general (the buyer's role resolves from `jobtitle`):
   - Prefer a proof point that matches the buyer's role and segment.
   - Use the specific improvement percentage / time reduction / accuracy gain
     from the approved entry; do not round up or extrapolate beyond what the
     entry states.
2. Apply the approved improvement to the buyer's own cost figure:
   "Buyer loses $400K/year to manual rework. PP-031 shows median 70% reduction in
   rework time across mid-market onboards. Proposed outcome: $280K reduction."
3. If `product-knowledge` returns no approved proof for a cost bucket, do one of:
   - Leave the line as a question mark with a note: "[Gap -- no approved benchmark
     for <bucket>. Work with SE/customer success to find a comparable reference
     before presenting this line to the buyer.]"
   - Ask the buyer to provide their own expectation: "What improvement would you
     need to see in <area> to consider this a success?" -- use their stated target
     as the proposed-state, clearly labeled as buyer-expectation rather than vendor
     proof.
4. Never borrow a benchmark from a different segment without noting the mismatch.

### Step 4 -- Calculate delta, payback, and ROI

1. Delta = proposed-state outcome (annual value) per step above.
2. Payback requires the investment figure. **Request it from `quote-desk`** -- do
   not invent a price. If the quote is not yet produced, insert a placeholder:
   "[Investment: pending quote-desk output -- insert ACV/TCV here before sharing
   the model with the buyer]."
3. Payback months = (Investment / (Annual delta / 12)).
4. 3-year ROI = ((Delta x 3 - Total 3-year investment) / Total 3-year investment)
   x 100. Show the formula, not just the answer; the buyer's finance team will
   check the math.
5. Sensitivity check: show a conservative (50% of approved proof) and an expected
   (100%) scenario. This is honest and pre-empts the "your numbers are optimistic"
   objection. Do not show an aggressive (>100%) scenario without a buyer-validated
   basis for it.

### Step 5 -- Assemble the model output

Produce a structured summary suitable for embedding in `proposal-builder` or
presenting in a champion-to-CFO brief:

```
BUSINESS CASE SUMMARY -- <Account> -- <Date>

CURRENT STATE
  [Cost bucket 1]: $X/year  (source: <buyer-stated>)
  [Cost bucket 2]: $X/year  (source: <buyer-stated>)
  Total current-state cost: $X/year

PROPOSED OUTCOME
  [Cost bucket 1]: $X reduction/year  (proof: <PP-xxx, approved, verified <date>>)
  [Cost bucket 2]: [Gap -- needs approved proof]
  Total value delivered (expected scenario): $X/year

INVESTMENT
  [Pending quote-desk -- insert ACV here]

PAYBACK
  Conservative (50% proof): X months
  Expected (100% proof):    X months

3-YEAR ROI
  Conservative: X%
  Expected:     X%

INPUTS SOURCING
  All buyer inputs: discovery call <date> / CRM record <id>
  All proof inputs: product-knowledge entries <ids>
  Investment: quote-desk (pending / <quote id>)
```

### Step 6 -- Log to CRM and flag for deal-review

1. Post the completed model (or the gap summary if M was unconfirmed) to the
   HubSpot deal record via `crm-operator`.
2. If gaps remain (M unconfirmed, proof missing, investment pending), flag them
   as open items in the deal's next-step notes so `deal-review` picks them up.

## Examples

**Well-sourced model:**

```text
Buyer: "Our reps spend 2 hours each week updating forecasts manually. We have 40
reps. We pay reps roughly $100K loaded, so about $50/hour."

Business case calculation:
  Current-state cost:
    40 reps x 2 hrs/week x 50 weeks x $50/hr = $200,000/year
    source: buyer-stated, VP Sales discovery call 2026-05-14.

  Proposed outcome:
    product-knowledge PP-031: "median 80% reduction in manual forecast entry
    (mid-market, 12 accounts, Q1-2026 internal data)".
    Applied: $200K x 80% = $160K/year value delivered.

  Investment: pending quote-desk -- placeholder inserted.

  Payback (expected): [investment] / ($160K / 12) = [X] months once quote complete.

  Conservative scenario (50% of PP-031): $80K/year -- payback doubles.
```

**M gap -- model paused:**

```text
Discovery note: "Forecast is a mess, takes forever."

Business case assessment:
  M is red -- no quantified metric. Buyer has described pain qualitatively only.
  Cannot build a credible model on vague language.

  Recommended probe (next call):
    "When you say it takes forever -- how many hours per week across the team,
    roughly? And what does a rep's loaded cost look like for you?"
  Once a number is confirmed, re-run this skill.

  DO NOT produce: "Based on industry benchmarks, this likely costs $150K/year."
  Reason: no buyer validation + no approved source for that figure.
```

**Proof point gap -- honest placeholder:**

```text
Cost bucket identified: "Customer support escalations from reporting errors".
  Buyer states: ~15 escalations/month, 4 hours each to resolve, $75/hr support cost.
  Current-state cost: 15 x 4 x 12 x $75 = $54,000/year.

  product-knowledge query: no approved proof point for "support escalation reduction".
  Closest entry: VP-009 (retention visibility -- general) -- not specific enough.

  Proposed-state line:
    "[Gap -- no approved proof for support escalation reduction. Add placeholder.]
    To complete this line: (a) ask SE if a comparable deployment exists, or
    (b) ask the buyer what a 50% reduction in escalations would mean to them and
    use their stated expectation, labeled buyer-hypothesis."
```

## Anti-patterns

- **Filling in M with an industry average the buyer has not validated.** "SaaS
  companies typically spend X on this" is not M evidence. M is the buyer's own
  number. Benchmark data from product-knowledge can corroborate; it cannot replace
  a buyer-stated figure.
- **Borrowing a proof point from the wrong segment.** An enterprise deployment
  result applied to an SMB deal will be challenged and will damage credibility.
  Match segment explicitly; if there is no segment match, say so.
- **Including pricing in the value model.** The business case shows value delivered
  (numerator of the ROI). Price (denominator) comes from `quote-desk`. Mixing them
  forces premature price anchoring.
- **Showing only the optimistic scenario.** A single "best case" number signals
  vendor enthusiasm, not rigor. The conservative scenario demonstrates intellectual
  honesty and pre-empts the finance team's skepticism.
- **Presenting the model to the buyer before the champion has reviewed it.**
  The champion should validate the inputs with the rep before the model goes to
  the economic buyer. A surprised champion will not defend numbers they have not
  seen. Use `stakeholder-mapping` to sequence this correctly.
- **Rounding up proof points.** If PP-031 says 70%, the model uses 70%, not "up
  to 80%" or "approximately 75%". The guardrail in product-knowledge is the ceiling.

## Related

- `product-knowledge` -- source for all approved proof points used in the
  proposed-outcome line.
- `quote-desk` -- owns pricing and investment figures; business-case inserts a
  placeholder and waits for the quote.
- `deal-review` -- M evidence score is the gate for Step 1 of this workflow.
- `proposal-builder` -- embeds the business case summary as a section;
  this skill runs first and hands off the output.
- `stakeholder-mapping` -- advises on who reviews the model before it goes to
  the economic buyer.
- `rules/meddpicc/qualification.md` -- M definition and evidence standard.
- `rules/meddpicc/deal-review.md` -- M scoring and gap-to-action discipline.
- `rules/common/selling-principles.md` -- no fabrication; cite every number.
