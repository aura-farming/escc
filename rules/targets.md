# Targets

The source of truth for quota, ramp, and activity targets — so `capacity-planning`, `coaching-prep`, `activity-audit`, `sales-reporting`, and the self-scoped `/quota` shim all use the same numbers. Actual figures live in the workspace config; this rule defines the model.

## Quota
- Each rep has a period quota (new business; expansion/renewal tracked separately where applicable). Team quota = sum of rep quotas plus any unassigned coverage.
- The pipeline-coverage target is a multiple of quota (commonly 3–4×); `sales-reporting` measures actual coverage against it.

## Ramp
- New reps ramp on a defined schedule (e.g. 30/60/90 → full) with reduced quota during ramp (`rep-onboarding`). Capacity math uses *ramped* quota, not full quota, for partially-ramped reps (`capacity-planning`).

## Activity targets
- Leading-indicator targets (dials, meaningful conversations, meetings booked, opportunities created) are set per segment (`rules/segments/*`) — enterprise carries lower volume / higher value than SMB.
- `activity-audit` scores cadence and logging compliance against these. Targets are coaching inputs, not surveillance — pair with `coaching-prep`.

## Discipline
- Targets are calibrated, not aspirational fiction. Capacity gaps (quota > ramped capacity × coverage) are surfaced, not hidden (`capacity-planning`).
