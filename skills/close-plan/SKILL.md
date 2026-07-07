---
name: close-plan
description: >-
  Seller's backward date-plan from target signature through every gate back to
  today. Trigger: 'close plan', 'path to signature', 'hit our close date'. The
  shared buyer plan is mutual-action-plan.
origin: ESCC
---

# Close Plan

The seller's backward date-plan: start from the target signature date and work
backwards through every enterprise gate to today, with dates and owners per step.

> **Governing rules:**
> - `rules/lifecycle-stages.md` — the close plan is built when a deal enters stage 4
>   (Proposal/Negotiation); it is updated at every stage advance.
> - `rules/common/meeting-standards.md` — every open deal leaves a meeting with a
>   scheduled, dated next step. The close plan is the source of those next steps.
> - `rules/segments/*.md` — enterprise has more gates (security review, multi-layer
>   procurement, board approval cycles); mid-market has fewer; SMB has fewer still.
>   Apply the segment overlay before setting timelines.
> - `rules/meddpicc/deal-review.md` — a close plan built on red MEDDPICC gaps is a
>   fantasy. Check the deal score before committing dates.

The close plan is the seller's internal sequencing tool. The shared view that a buyer
co-commits to is the `mutual-action-plan`; this is the seller's backward-dated map of
every internal and external gate from signature to now. They are complementary, not
redundant: the mutual-action-plan shows the buyer a collaborative path; the close plan
shows the seller every step and its risk.

## When to Activate

Activate this skill when:

- A deal is entering or is in Proposal/Negotiation stage (`rules/lifecycle-stages.md`).
- A rep asks how to map the path from today to a target close date.
- A manager is inspecting whether a committed close date is credible.
- A deal has a close date in the CRM but no documented steps backing it.
- The target close date changes and the plan must be rebuilt backward from the new date.
- Segment-specific gates (e.g. security review, multi-tier procurement) need to be
  explicitly sequenced.

Do **not** activate for:
- The buyer-facing collaborative milestone plan — that is `mutual-action-plan`.
- Tracking individual legal document status (MSA, DPA redline version) — that is
  `paper-process`. The close plan sequences the paper process gates; paper-process
  tracks each artifact inside them.
- Negotiation tactics and concession planning — that is `negotiation-prep`.
- MEDDPICC scoring — that is `rules/meddpicc/deal-review.md`.

## Workflow

### Step 1 — Anchor on the target signature date and confirm its basis

1. Identify the target signature date. Ask: **why this date?** A credible close date
   has a buyer-acknowledged reason (budget cycle, implementation window, board
   mandate, compliance deadline). A rep-driven date ("my quarter ends") is a
   planning assumption, not a commitment.
2. Confirm whether the date has been verbally agreed by the economic buyer. If the
   EB has not acknowledged the date, it is amber — note it and probe at the next
   EB touchpoint.
3. Check the current MEDDPICC status via `rules/meddpicc/deal-review.md`. A red
   EB or red decision process makes the close date structurally unreliable; flag
   before building the plan rather than embedding the gap into dates.

### Step 2 — Apply the segment overlay to identify the gate set

Different segments have materially different gate counts and lead times. Pull the
relevant overlay before setting any backward dates:

- **Enterprise** (`rules/segments/enterprise.md`): mandatory security review,
  multi-layer procurement (commercial + legal + finance), potential board approval,
  executive sponsor sign-off. Typical gate lead times: security review 2-4 weeks,
  legal redlines 2-6 weeks, procurement commercial review 1-3 weeks, EB final
  approval 1-2 weeks. Stack these; they rarely run fully in parallel.
- **Mid-market** (`rules/segments/mid-market.md`): lighter procurement; legal
  review often shorter; security review may exist but is faster. Fewer stakeholder
  layers.
- **SMB** (`rules/segments/smb.md`): often no formal procurement or security
  review; primarily EB decision + standard order form / click-through terms.

> Always confirm actual timelines with the champion and decision-process notes
> from discovery — segment defaults are a planning floor, not a guarantee.

### Step 3 — Build the backward date-plan

Start from the target signature date and work backward. Every gate gets:
- **Gate name** and description of what must be true to pass it.
- **Owner** (internal rep action, champion action, buyer-side role).
- **Target completion date** (derived by working backward from signature).
- **Status** (not started / in progress / complete / blocked).
- **Dependency** (which gate must complete before this one starts).

Standard enterprise gate sequence (reverse-ordered from signature):

| # | Gate | Typical lead time | Owner |
|---|---|---|---|
| 0 | Signature / order form executed | target date | Buyer EB + Rep |
| 1 | Legal sign-off — final MSA/DPA redlines resolved | 1-2 weeks before #0 | Buyer legal + Rep legal team |
| 2 | Procurement commercial approval — pricing and terms accepted | 1-2 weeks before #1 | Buyer procurement + Rep |
| 3 | Security review complete — questionnaire returned + approved | 2-4 weeks before #2 | Buyer security + Rep SE/security team |
| 4 | EB engagement — EB has reviewed proposal and given internal green light | 1 week before #2 | Champion + Rep |
| 5 | Proposal / business case delivered to EB | 1 week before #4 | Rep |
| 6 | Paper process opened — MSA first draft sent | before #3 starts | Rep + legal team |
| 7 | Mutual action plan (initiated at Validation/Proof per `mutual-action-plan`) confirmed/agreed with buyer | before #3 starts | Rep + Champion |
| 8 | Commercial proposal and pricing delivered | before #5 | Rep + `quote-desk` |

Adjust gate count and lead times for the segment and deal specifics. Mid-market may
collapse #2 and #4; SMB may skip #2, #3, and #4 entirely.

Work the dates backward:
- Signature target: [date]
- Legal sign-off needed by: [date - 1 to 2 weeks]
- Procurement approval needed by: [date of legal sign-off - 1 to 2 weeks]
- Security review needed by: [date of procurement - 2 to 4 weeks]
- EB green light needed by: [concurrent with procurement, triggered by proposal]
- Paper process must open by: [date of security review start]
- Proposal delivered by: [date of EB engagement - 1 week]
- TODAY: Are you here or behind?

### Step 4 — Identify the critical path and risks

1. **Critical path:** which gate has the longest fixed lead time and cannot be
   compressed? For enterprise, security review is typically the critical path gate.
   Starting it late is the most common close-date failure mode.
2. **Risk flags to surface in the close plan:**
   - Paper process not started within 6 weeks of target — high risk.
   - EB not confirmed on the close timeline — medium risk.
   - Champion not engaged at procurement / legal — high risk.
   - Security review questionnaire not sent within 4 weeks of target (enterprise) — high risk.
   - Close date with no mutual action plan counterpart — medium risk.
3. Map each risk to a next action with an owner and date, consistent with
   `rules/common/meeting-standards.md` (every open deal, dated next step).

### Step 5 — Link to the mutual-action-plan and paper-process

- The `mutual-action-plan` (shared buyer+seller plan) should reflect the buyer-visible
  milestones from this close plan. The two plans are not identical: the close plan
  includes internal seller gates (internal approvals, pricing routing, SE resource
  scheduling) that do not belong in the shared plan. Sync the buyer-visible milestones.
- The `paper-process` tracks each legal document (MSA, DPA, order form, security
  questionnaire) individually. The close plan references `paper-process` as a gate;
  it does not re-track each document. When a paper-process artifact is blocked,
  pull the blocker into the close plan as a risk with an owner and date.

### Step 6 — Keep the plan live

- Update after every buyer interaction, stage advance, or gate completion.
- Flag any gate slipping more than one week; a 1-week slip in an enterprise deal
  typically propagates to the close date.
- At each update, re-run the backward date math from the latest known signature date.
- Log close plan updates to HubSpot via `crm-operator`; a close plan that only lives
  in a document outside the CRM is invisible to management and forecasting.

## Examples

**Enterprise deal — close plan built from signature date:**

```text
Deal: Example Co Corp, $180k ARR, target signature 2026-09-30 (EB-acknowledged: board
  budget cycle closes Sept).
Segment: enterprise (rules/segments/enterprise.md).
MEDDPICC check: E GREEN (CFO named), D AMBER (multi-step process known but
  board approval cadence unclear), P RED (paper process not opened).

Backward date-plan:

  Gate 0: Signature — 2026-09-30 | Owner: CFO (EB) + Rep
  Gate 1: Legal sign-off (MSA + DPA) — 2026-09-16 | Owner: Buyer legal + Rep legal
    Status: not started | Risk: paper not opened — CRITICAL, open this week.
  Gate 2: Procurement commercial approval — 2026-09-09 | Owner: Procurement lead + Rep
    Status: not started | Depends on: legal sign-off in progress by 09-09
  Gate 3: Security review complete — 2026-08-19 | Owner: Buyer InfoSec + Rep SE
    Status: not started | Lead time: 4 weeks | Risk: must send questionnaire by 08-19
  Gate 4: EB (CFO) green light — 2026-09-02 | Owner: Champion (VP Ops) + Rep
    Status: in progress | Champion briefing scheduled 2026-07-22
  Gate 5: Proposal delivered to EB — 2026-08-26 | Owner: Rep + quote-desk
    Status: quote-desk routing in progress
  Gate 6: Paper process opened (MSA first draft sent) — 2026-07-25 | Owner: Rep
    Status: NOT STARTED — RED. Action: open paper-process today.
  Gate 7: Mutual action plan agreed — 2026-07-29 | Owner: Rep + Champion
    Status: in progress

Critical path: security review (Gate 3). Must send questionnaire by 2026-07-25.
Top risk: paper process not opened. Owner: Rep. Due: 2026-07-25 (today).
```

**Mid-market deal — abbreviated plan:**

```text
Deal: Beta Inc, $28k ARR, target signature 2026-08-15.
Segment: mid-market. No formal security review required.

  Gate 0: Signature (order form) — 2026-08-15
  Gate 1: Legal sign-off (standard MSA) — 2026-08-08 | 1 week
    paper-process status: first draft sent 2026-07-18, one redline outstanding.
  Gate 2: EB approval (VP Finance) — 2026-08-05 | Proposal delivered; champion
    confirmed EB has budget.
  Gate 3: Pricing confirmed (quote-desk) — 2026-07-30 | Done.
  Gate 4: Mutual action plan shared with buyer — 2026-07-22 | Done.

No critical path risk today. Monitor MSA redline; expected back 2026-07-25.
```

**Close date credibility check (deal inspection):**

```text
Manager: This deal is committed for Q3 close. Walk me through the close plan.
Rep: Target signature 2026-09-30. Let me map the gates...
  [builds backward plan — see enterprise example above]
  Current gap: paper process not opened, security review not started with 10 weeks
  to close. For enterprise, security review alone is 4 weeks. If we open paper
  process today and send the security questionnaire this week, we have a credible
  path. If either slips 2 weeks, we are at risk.
Manager verdict: amber — credible if actions taken this week; re-inspect in 7 days.
```

## Anti-patterns

- **Building a close plan without checking MEDDPICC.** A plan with dates on top of a
  red economic buyer or unknown decision process is not a plan; it is a close-date
  decoration. Run `rules/meddpicc/deal-review.md` first.
- **Rep-driven dates with no buyer acknowledgment.** "My quarter ends" is not a
  buyer-anchored close date. The EB must acknowledge the timeline; absent that, the
  date is a forecast assumption, not a commitment.
- **Skipping the segment overlay.** An enterprise deal with no security review gate
  in the plan will miss the close date. Apply `rules/segments/enterprise.md` before
  setting timelines.
- **Confusing close plan with mutual-action-plan.** The mutual-action-plan is the
  shared buyer+seller document; the close plan includes internal seller gates the
  buyer does not need to see. Sync buyer-visible milestones; do not merge the two.
- **Re-tracking paper-process artifacts here.** The close plan references the paper
  process as a gate (is it unblocked?); it does not duplicate the per-document status
  that `paper-process` owns.
- **Static plans.** A close plan updated once and never touched again provides false
  confidence. Update after every buyer interaction; re-run backward date math at
  each update.
- **No critical path identification.** A list of gates with no critical path
  analysis misses where the plan is fragile. Identify the longest-lead gate and
  watch it weekly.

## Related

- `mutual-action-plan` — the shared buyer+seller milestone plan. The close plan
  references it; the close plan is NOT a replacement for it.
- `paper-process` — tracks individual legal document status (MSA, DPA, order form,
  security questionnaire). The close plan sequences paper-process as a gate block;
  paper-process tracks each artifact inside.
- `negotiation-prep` — the seller's commercial preparation playbook; complements
  the timeline this skill produces.
- `rules/lifecycle-stages.md` — stage definitions and entry/exit criteria.
- `rules/segments/enterprise.md`, `rules/segments/mid-market.md`,
  `rules/segments/smb.md` — gate count and lead-time overrides per segment.
- `rules/common/meeting-standards.md` — every open deal, dated next step.
- `rules/meddpicc/deal-review.md` — deal health scoring; must be checked before
  committing dates in the close plan.
