# Lifecycle Stages

The canonical funnel. Every stage has entry criteria and exit (advance) criteria; a deal/lead may not occupy a stage whose criteria are unmet (`crm-hygiene`, `forecasting-definitions`). `pre:crm-write-guard` checks stage advances.

## Lead lifecycle
- **Subscriber / Lead** — raw, unqualified.
- **MQL** — marketing-qualified: fits ICP signals (`icp-profile`).
- **SAL** — sales-accepted: a rep accepts the lead as worth working. *Accept* or *reject* with a reason within the response SLA.
- **SQL** — sales-qualified: a real, qualified opportunity exists (becomes a Deal).

## Deal stages (opportunity)
1. **Discovery** — pain, stakeholders, and metrics being established (`meddpicc/qualification`).
2. **Qualification** — MEDDPICC materially in place; economic buyer identified.
3. **Validation / Proof** — demo / POC / evaluation against agreed success criteria (`evaluation-plan`).
4. **Proposal / Negotiation** — proposal, pricing (`quote-desk`), paper process (`paper-process`).
5. **Closed Won / Closed Lost** — outcome recorded with a reason (feeds `win-loss-analysis`).

## Accept / reject / disqualify / recycle
- SAL accept/reject is explicit and logged; a rejected lead returns to nurture with a reason.
- Disqualify requires a reason code; recycle sets a re-engage date. Neither is a delete.

## Stage discipline
- Forecast category must be consistent with stage (`forecasting-definitions`). No skipping stages to inflate a number; no parking a stalled deal in a late stage.
