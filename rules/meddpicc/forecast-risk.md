This file extends [common/forecasting-definitions.md](../common/forecasting-definitions.md) with MEDDPICC risk-weighting — how qualification gaps discount a forecast category.

# MEDDPICC — Forecast Risk

Turns MEDDPICC gaps into forecast discipline for `forecast-rollup` and `forecast-accuracy`.

## Weighting
- A **commit** requires green (or evidenced amber) Metrics, Economic buyer, Decision process, and Paper process, plus a mutual close plan. A red in any of these means it is **not** a commit, regardless of rep optimism.
- Best-case tolerates amber on non-critical elements but not a missing economic buyer.

## Risk patterns that downgrade
- No economic-buyer access → downgrade.
- Paper/security process not started within the stage's window → downgrade.
- A close date inside the segment's cycle-length floor (`rules/segments/*`) with early-stage MEDDPICC → downgrade.
- A single-threaded late-stage deal → downgrade ("multi-thread-before-close" seed).

## Honesty
- Risk is reported, not hidden. A downgrade now beats a missed commit later (`forecasting-definitions`: discipline).
