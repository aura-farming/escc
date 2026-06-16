# Forecasting Definitions

Shared definitions so "commit" means the same thing for every rep and manager. Used by `forecast-rollup`, `forecast-accuracy`, `deal-review`, and the `meddpicc/forecast-risk` overlay.

## Forecast categories
- **Commit:** the rep will personally stake their name on it closing this period — identified economic buyer, confirmed budget and paper path, a mutual close plan, MEDDPICC gaps closed. High confidence.
- **Best case:** could realistically close this period if upside breaks right; known risks remain. Medium confidence.
- **Pipeline:** open and qualified for the period but not yet best-case; material gaps remain.
- **Omitted / Closed:** not forecast for the period (too early, slipped, or closed won/lost).

## Stage-exit criteria
- A deal may not sit in a stage whose exit criteria are unmet; stage and forecast category must be consistent (a "commit" cannot sit in early discovery).
- Canonical stages and their entry/exit gates are defined in `rules/lifecycle-stages.md`.

## MEDDPICC-weighted risk
- Forecast confidence is weighted by MEDDPICC completeness (`meddpicc/forecast-risk.md`): missing Metrics, Economic buyer, or Decision process materially discounts a commit.
- "MEDDPICC-gap-check-before-forecast" is a default behavior (seed instinct).

## Discipline
- Report change-vs-last-week honestly: slips, pull-ins, new, expansion. No silent re-categorization to protect a number.
