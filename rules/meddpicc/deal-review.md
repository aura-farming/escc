This file extends [common/forecasting-definitions.md](../common/forecasting-definitions.md) with MEDDPICC-based deal-review scoring — how a single deal is interrogated before it counts toward a forecast.

# MEDDPICC — Deal Review

The structure for `deal-review`, `deal-inspection`, and `/deal-review`. Scores a deal's MEDDPICC completeness and surfaces the gaps that gate the next stage.

## Scoring
- Score each MEDDPICC element red / amber / green with the **evidence** that justifies it (a quote, a record, a document). No evidence → red.
- A deal's health is gated by its weakest critical element: a green-everything deal with no identified economic buyer is not green.

## Gap-to-action
- Every red/amber becomes a specific next action with an owner and date (`meeting-standards`: a next step on every open deal).
- Committee coverage (are all buying-committee roles engaged?) is a deal-review mode, fed by `stakeholder-mapping`.

## Risk flags
- Single-threaded (only one contact), no economic buyer, paper process not started late-stage, a close date with no mutual plan, an entrenched competitor — each flag discounts confidence (`meddpicc/forecast-risk`).
