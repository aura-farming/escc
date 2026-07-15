---
name: quote-desk
description: >-
  The pricing-math owner — CPQ quotes, discounts, ramps, tiers, approval
  routing. Trigger: 'what should I quote', 'can I give X% off', 'what needs
  approval'. Other skills defer here for any number.
origin: ESCC
---

# Quote Desk

The **canonical pricing-math owner** for ESCC. Every discount calculation, packaging
decision, ramp structure, and approval-routing step lives here. Skills that need a
number — `proposal-builder`, `business-case`, `negotiation-prep` — defer to this skill
rather than deriving pricing independently.

> **Governing rules:**
> `rules/approval-matrix.md` — the source of truth for all approval-tier thresholds
> (rep/manager/VP/CRO+Finance). This skill reads and applies that matrix; it does **not**
> duplicate the thresholds inline as its own source of truth.
> `rules/targets.md` — quota and ramp targets inform deal sizing and coverage math.
> `rules/common/selling-principles.md` — pricing and packaging facts come only from
> approved `product-knowledge` entries; no fabricated list prices or capacity limits.
> `rules/common/forecasting-definitions.md` Currency-correctness clause (v1.8.0) —
> every quote states its currency; a multi-currency ramp or comparison normalizes
> through the workspace locale config (rate + as-of stated), never by mixing units.

## When to Activate

Activate this skill when:

- A rep needs to **build or sanity-check a CPQ quote** — list price, discount, net ACV,
  payment schedule, or contract term.
- A **discount is being requested or negotiated** and you need to know (a) whether it is
  self-serve or requires approval, and (b) who the approver is.
- Structuring a **ramp deal** (Year 1 / Year 2 / Year 3 step-up), a **multi-year
  commitment**, or a **free-period arrangement** and you need the revenue-recognition
  and approval implications.
- **Packaging or SKU selection** is unclear — which tier fits the buyer's seat count,
  use-cases, or segment (segment overrides: `rules/segments/enterprise.md`,
  `rules/segments/mid-market.md`, `rules/segments/smb.md`).
- `proposal-builder`, `business-case`, or `negotiation-prep` ask for a **concrete
  price or discount figure** — they must route here first, not derive their own number.
- A non-standard term (custom legal, unusual payment schedule, MFN clause) needs to be
  flagged for the correct escalation tier.

Do **not** activate for pure proposal prose (that is `proposal-builder`), ROI
narrative (that is `business-case`), or negotiation tactics without a pricing question
(that is `negotiation-prep`). This skill is the **number layer**; the other skills own
the narrative around it.

## The quote model

A quote has five components, each computed in order:

| Component | What it represents |
|---|---|
| **List price** | The published / catalog price for the selected SKU at stated volume. From `product-knowledge` (approved SKU/pricing entries only). |
| **Discount** | % off list, by discount type (volume, competitive, strategic, etc.). Constrained by tier rules below. |
| **Net ACV** | `list_price * (1 - discount_rate)` annualised. The number that drives approval routing. |
| **Ramp schedule** | Year-over-year step-up if applicable. Must reflect contracted commitment, not aspirational upsell. |
| **Payment terms** | Annual-upfront / quarterly / monthly. Non-standard schedules escalate per the matrix. |

State each component explicitly in the quote output. Do not collapse them into a single
"here is the number" — the approver and the buyer both need the breakdown.

## The discount-tier model (sourced from rules/approval-matrix.md)

Read the current thresholds from `rules/approval-matrix.md` at run-time. The shape is:

- **Tier 0 (rep self-serve):** discount at or below the rep-autonomy ceiling — logged,
  no additional approver required.
- **Tier 1 (Sales Manager):** mid-range discount or the ACV crosses the lower ACV band.
- **Tier 1+ (Sales Manager + RevOps):** same discount band but ACV crosses the upper
  band — RevOps join because the deal size has P&L visibility.
- **Tier 2 (VP Sales):** high-discount band, any ACV.
- **Tier 3 (CRO + Finance):** above the VP ceiling, or any non-standard term — revenue
  recognition routes to Finance.

When a ramp deal or multi-year commitment is involved, **escalate one tier** beyond what
the plain discount% would suggest, per the matrix non-standard-terms rule.

## Workflow

### A. Build a quote from scratch

1. **Pull approved SKU / list-price facts from `product-knowledge`.** Never state a
   list price that is not in an approved entry. If the entry is missing, surface the gap
   and pause — do not invent a number.
2. **Establish the deal parameters:** seat count (or consumption unit), term length,
   start date, and any agreed ramp or free-period.
3. **Compute list ACV:** seats (or units) x unit price x term fraction = annual list ACV.
4. **Apply the requested discount:** compute net ACV = list ACV x (1 - discount%).
   Flag: does this discount fall in Tier 0, Tier 1, Tier 1+, Tier 2, or Tier 3?
5. **Check non-standard triggers:** ramp, multi-year, custom payment, free period,
   non-standard legal. Each adds one escalation tier.
6. **State the required approver(s)** from the matrix. Do not offer the term to the
   customer before confirming the approval step is recorded.
7. **Produce the quote output** (see Examples below): each component listed explicitly,
   approval tier named, next action stated.
8. **Route to `crm-operator` for any CRM logging.** A quote summary is logged against
   the deal record; `governance-capture` records `approval_requested` when an approval
   is needed. No CRM write happens outside `crm-operator`.

### B. Evaluate an incoming discount request

1. **Take the discount% and net ACV as stated** (verify the math — recalculate from
   first principles if you have list price and seats).
2. **Look up the tier** from `rules/approval-matrix.md`.
3. **Check for non-standard escalators** (ramp, custom legal, etc.).
4. **Return the verdict:** self-serve / needs approval (with named approver) / needs
   escalation (with reason). Include the re-routing instruction if escalation is needed.

### C. Structure a ramp deal

1. **Define Year 1 net ACV** — the contracted (not aspirational) seat/unit commitment
   at the agreed Year 1 discount.
2. **Define Year 2 and Year 3 step-ups** — either a fixed seat-count growth or a
   percentage uplift, tied to a commercial trigger (e.g. seat expansion, usage threshold).
   Ramp schedules must be contractually binding, not a "we expect to grow" note.
3. **Compute TCV (total contract value)** = sum of all year ACVs.
4. **Identify the approval tier** using the *highest* single-year net ACV, then escalate
   one further tier because the deal is a ramp (non-standard term).
5. **Flag revenue-recognition implications** to Finance if any year's billing deviates
   from standard annual-upfront. Route to CRO + Finance if so.

### D. Select the right packaging / tier

1. **Map buyer's stated use-case and seat count** to the SKU options in `product-knowledge`.
2. **Apply segment overlay** from `rules/segments/enterprise.md`,
   `rules/segments/mid-market.md`, or `rules/segments/smb.md` — segment rules may specify
   minimum tiers, bundled modules, or preferred packaging.
3. **Prefer the tier the buyer can actually consume** on Day 1 — over-tiering for upsell
   potential is a friction risk and a trust risk. Note the natural expansion path without
   baking it into the contract.
4. **Return the recommended SKU + rationale**, with the list ACV, ready for step A above.

## Examples

**Standard quote, Tier 1 approval required:**

```text
Deal: Example Co Corp, 50 seats, Professional tier, 12-month term.
List price (from product-knowledge, SKU PRO-50): $1,200/seat/year
List ACV: 50 x $1,200 = $60,000
Requested discount: 18%
Net ACV: $60,000 x 0.82 = $49,200
Approval tier (rules/approval-matrix.md):
  Discount 18% (10-20 band), Net ACV $49,200 (< $50k band) -> Sales Manager approval.
Non-standard escalators: none (standard annual-upfront, no ramp).
Required approver: Sales Manager.
Next action: Rep submits approval request via deal-desk before sharing pricing with Example Co.
CRM log: routed to crm-operator — deal record updated, governance-capture records
  approval_requested.
```

**Ramp deal, escalated to VP Sales:**

```text
Deal: Sample Co, 80 seats Y1 / 120 seats Y2 / 160 seats Y3, Enterprise tier.
List price (SKU ENT-80+): $1,800/seat/year
Year 1 net ACV: 80 x $1,800 x (1 - 20%) = $115,200
Year 2 net ACV: 120 x $1,800 x (1 - 15%) = $183,600
Year 3 net ACV: 160 x $1,800 x (1 - 10%) = $259,200
TCV: $558,000
Discount 20%, highest-year ACV $259,200.
Base tier: 20% discount -> VP Sales (Tier 2, rules/approval-matrix.md).
Non-standard escalator: ramp deal -> escalate one further tier -> CRO + Finance.
Required approvers: CRO + Finance.
Revenue-recognition flag: staggered billing years -> Finance must confirm recognition.
Next action: VP Sales sponsors the CRO + Finance approval request.
```

**Discount request, Tier 0 (self-serve):**

```text
Inbound request: can I give 8% off to close Demo Co this quarter?
List ACV: $22,000. Requested discount 8%.
Net ACV: $20,240.
Tier check (rules/approval-matrix.md): 8% <= rep-autonomy ceiling -> Tier 0, self-serve.
Verdict: Rep may offer this discount. Log the discount reason to HubSpot via crm-operator.
No additional approver required.
```

**Missing list price — blocked:**

```text
Request: quote for the Analytics Add-on at 15% off.
product-knowledge check: no approved SKU entry for "Analytics Add-on". List price unknown.
BLOCKED. Do not fabricate a list price.
Next action: Rep confirms the correct SKU with their SE or PM, then re-runs quote-desk.
```

**Packaging selection — SMB segment:**

```text
Buyer: 8-person RevOps team, needs pipeline reporting, no advanced forecasting yet.
Segment: SMB (rules/segments/smb.md).
SKU options (product-knowledge): Starter (1-10 seats, core reporting) / Professional
  (advanced forecasting, custom dashboards).
Segment overlay: SMB preferred entry-point is Starter where use-case fits.
Recommendation: Starter tier — fits Day 1 use-case; natural expansion trigger is when
  they need custom dashboards (note in deal record, not in contract).
List ACV at 8 seats: [pull from product-knowledge SKU STR-8 entry].
```

## Anti-patterns

- **Deriving a price from memory or a plausible estimate.** List prices and SKU limits
  come only from approved `product-knowledge` entries. A fabricated list price corrupts
  the entire quote — if the entry is missing, block and surface the gap.
- **Other skills computing discount math independently.** `proposal-builder`,
  `business-case`, and `negotiation-prep` must pass through `quote-desk` for any number.
  Cross-skill pricing drift creates contradiction and compliance risk.
- **Offering a term before the approval is recorded.** The approval sequence in
  `rules/approval-matrix.md` is a pre-condition, not a formality after the fact. No
  number goes to the buyer before the required approver is notified and on-record.
- **Ramp optimism.** Year 2 and Year 3 seat counts in a ramp must be contractually
  committed or clearly labelled as non-binding forecasts. A growth expectation
  presented as a committed step-up is a false representation.
- **Treating a discount-approval acknowledgement as a CRM write.** CRM writes go
  through `crm-operator`. A verbal or Slack acknowledgement is not a logged approval.
- **Skipping the non-standard escalator.** Ramps, free periods, custom legal, and
  unusual payment schedules each escalate one tier beyond the plain discount% tier.
  Forgetting this undersells the approval requirement and creates legal exposure.
- **Hardcoding approval thresholds.** The thresholds live in `rules/approval-matrix.md`
  and may be calibrated per workspace. Quote-desk reads the rule; it does not carry its
  own duplicate copy that can drift.

## Related

- Pricing source of truth: `product-knowledge` (approved SKUs + list prices).
- Approval thresholds: `rules/approval-matrix.md` (the sole source — read, do not copy).
- Deal sizing context: `rules/targets.md` (quota and coverage targets for deal sizing).
- Proposal narrative wrapping this output: `proposal-builder`.
- ROI / business-case narrative: `business-case`.
- Negotiation framing: `negotiation-prep`.
- CRM write for quote logging and approval record: `crm-operator`.
- Stage gate that quote-desk serves: stage 4 "Proposal / Negotiation" in
  `rules/lifecycle-stages.md`.
- Segment packaging overrides: `rules/segments/enterprise.md`,
  `rules/segments/mid-market.md`, `rules/segments/smb.md`.
