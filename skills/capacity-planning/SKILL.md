---
name: capacity-planning
description: >-
  Use when top-down revenue capacity needs to be checked or modeled -- whether
  the current headcount of ramped reps can cover the quota at the required
  pipeline multiple. Trigger on "capacity planning", "do we have enough reps",
  "headcount to hit target", "rep capacity gap", "how many reps do we need",
  "ramp capacity", "can we hit quota with current headcount", "coverage gap vs.
  target", or any request to map quota to required headcount factoring ramp.
origin: ESCC
---

# Capacity Planning

Top-down revenue capacity analysis: given the quota and pipeline-coverage
target, how much RAMPED rep capacity does the team actually have, and where
are the gaps? This skill surfaces gaps; it does not hide them.

> **Governing rules:**
> `rules/targets.md` -- quota, ramp schedule (e.g. 30/60/90 -> full), ramped
> quota definition, and pipeline-coverage target. This skill DEFERS to that
> rule for all threshold numbers. Ramped quota (not full quota) is used for
> partially-ramped reps; this is a hard requirement, not an option.
> `rules/segments/*` -- segment-level quota allocation and territory split.
>
> **Gap formula (stated in words, not hardcoded numbers):**
> If quota exceeds ramped capacity x coverage target, there is a capacity gap.
> Gap amount = quota - (ramped_rep_capacity x coverage_target_multiple).
> Surface the gap; do not smooth it into a "stretch goal" framing.
>
> **Execution:** the `pipeline-auditor` agent reads the rep roster and
> ramp-start dates from HubSpot (read-only); `metrics-analyst` computes
> the capacity math from that tool-result. It does NOT query HubSpot directly.
> Any headcount record updates route through `crm-operator` only.

## When to Activate

Activate this skill when:

- A Sales Manager or CRO wants to know **whether current headcount can hit
  the period or annual quota** at the required pipeline-coverage multiple.
- A RevOps analyst is **modeling hiring scenarios** -- how many net-new ramped
  reps are needed by quarter to close a capacity gap.
- A manager wants to understand **how a rep departure or ramp delay** changes
  the team's revenue capacity.
- The `/capacity` command is invoked.

Do **not** use this skill to:
- Check whether a single deal will close (that is `deal-review`).
- Report period attainment (that is `sales-reporting`).
- Model individual rep activity targets (that is `activity-audit`).
- Run a QBR headcount narrative (that is `qbr-builder`, which may consume
  this skill's output).

---

## Core Concepts

### Ramped Quota vs. Full Quota

A new rep is not immediately at full productivity. The ramp schedule
(defined in `rules/targets.md`) gives each rep a reduced effective quota
during their ramp period -- e.g., 30% in month 1, 60% in month 2, 90%
in month 3, 100% thereafter. Always use the ramped quota for partially-
ramped reps when computing capacity. Using full quota for ramp-stage reps
overstates the team's true revenue capacity and hides the gap.

Ramped quota for a rep at ramp month M = full_rep_quota x ramp_factor(M),
where ramp_factor is defined in `rules/targets.md`.

### Ramped Capacity

Ramped capacity = sum of each rep's effective (ramped) quota for the period.

For a fully ramped rep: effective quota = full rep quota.
For a rep in ramp month M: effective quota = full_rep_quota x ramp_factor(M).

### The Gap Formula

If the team quota exceeds ramped capacity x coverage target multiple, there
is a capacity gap.

gap = quota - (ramped_capacity x coverage_target_multiple)

Where coverage_target_multiple comes from `rules/targets.md` (3-4x; defer
to that rule for the exact configured figure).

A positive gap means the current team cannot generate sufficient pipeline to
cover quota at the required multiple -- even if every rep performs at full
efficiency. That is a headcount gap, not a performance gap.

---

## Workflow

### Step 1: Establish Period Scope

Confirm the period (quarter or annual), the quota level (team, segment, or
individual), and whether to model current state or a hiring scenario.

### Step 2: Pull Rep Roster and Ramp Status

The `pipeline-auditor` agent reads the rep roster and ramp dates from
HubSpot (read-only); `metrics-analyst` computes the capacity math from
that tool-result:
- All active reps with their segment, full quota, and hire/ramp-start date.
- Each rep's current ramp month (months since ramp-start date).
- Ramp factor for each rep (from `rules/targets.md` schedule).
- Any open head count (approved but unfilled roles -- zero capacity until
  filled).

### Step 3: Compute Ramped Capacity

For each rep:
  effective_quota = full_rep_quota x ramp_factor(current_ramp_month)
  (Fully ramped reps: ramp_factor = 1.0)

Ramped capacity = sum of all reps' effective quotas.

State the roster count: total reps, fully ramped count, ramp-stage count,
and open head count (zero contribution until filled).

### Step 4: Compute the Gap

Pull period quota from `rules/targets.md`.

pipeline_capacity_needed = quota x coverage_target_multiple
                           (coverage_target_multiple from rules/targets.md)

gap = pipeline_capacity_needed - ramped_capacity

If gap > 0: surface it. State the gap in dollars and in rep-equivalents
(gap / full_rep_quota = number of additional fully-ramped reps needed).

If gap <= 0: state that current ramped capacity covers the quota at the
required pipeline-coverage multiple.

### Step 5: Model Hiring Scenarios (if requested)

For each hiring scenario (e.g., "+2 reps starting Q2", "+1 rep starting Q1"):
1. Add the rep(s) at ramp month 0 for their start month.
2. Project their ramped quota forward by month through the period using the
   ramp schedule from `rules/targets.md`.
3. Recompute ramped capacity and gap for each month in the period.
4. Report: in which month does the gap close (if ever) under this scenario?

State clearly: a rep hired in month M does not contribute full quota until
month M + ramp_duration. A hire today closes a gap in the future, not now.

### Step 6: Return the Capacity Summary

Return:
- Period quota and coverage target (citing `rules/targets.md`).
- Roster table: rep name, segment, ramp status, effective quota.
- Total ramped capacity.
- Pipeline capacity needed (quota x coverage_target_multiple).
- Gap (dollar and rep-equivalent). If no gap, state that explicitly.
- Hiring scenario projections, if modeled.
- Top recommended action (hire, accelerate ramp support, or no action needed).

---

## Examples

**Current-state capacity check, team level:**

```text
Request: "Do we have enough reps to hit the Q3 quota?"

Period: Q3 2026
Team quota (rules/targets.md): $4,000,000
Coverage target (rules/targets.md): 3x

Roster (pipeline-auditor tool-result, analyzed by metrics-analyst):
  Rep            | Segment     | Full quota  | Ramp mo. | Ramp factor | Eff. quota
  ---------------|-------------|-------------|----------|-------------|----------
  Alex Rivera    | Enterprise  | $600,000    | Fully    | 1.00        | $600,000
  Sam Okafor     | Enterprise  | $600,000    | Fully    | 1.00        | $600,000
  Jamie Chen     | Mid-market  | $320,000    | Fully    | 1.00        | $320,000
  Morgan Lee     | Mid-market  | $320,000    | Month 2  | 0.60        | $192,000
  Taylor Kim     | SMB         | $160,000    | Month 1  | 0.30        | $ 48,000
  Jordan Patel   | SMB         | $160,000    | Fully    | 1.00        | $160,000
  [Open headcount: 1 Enterprise role, unfilled]                       | $0

Total ramped capacity: $1,920,000

Pipeline capacity needed: $4,000,000 x 3x = $12,000,000
GAP: $12,000,000 - $1,920,000 (x3) = pipeline demand exceeds what
     current team can generate at full efficiency.

Rep-equivalent gap: $12,000,000 pipeline needed / $600,000 enterprise eff.
     quota = team needs effectively ~20 rep-equivalents of pipeline generating
     capacity; current team has ~3.2 rep-equivalents (ramped capacity /
     average full quota).

Dollar gap in ramped capacity vs. quota alone: $4,000,000 - $1,920,000 =
     $2,080,000. Even before the coverage multiple, the team is $2.08M short
     on attainment capacity.

Action: Fill the open enterprise headcount immediately (adds $600k full
quota; ramped contribution ~$180k by Q3 end at month-1 ramp rate). Model
below for hiring scenarios.
```

**Hiring scenario: fill open role + 1 additional mid-market hire in month 1:**

```text
Scenario: Fill open Enterprise role month 1 + hire 1 additional Mid-market
rep month 1.

Month-by-month ramped capacity additions (Q3 = months 1-3):

New Enterprise hire (month 1 start, ramp 30/60/90):
  Month 1: $600k x 0.30 = $180,000
  Month 2: $600k x 0.60 = $360,000
  Month 3: $600k x 0.90 = $540,000
  Q3 total contribution: $1,080,000 / 3 months = avg $360k/mo

New Mid-market hire (month 1 start):
  Month 1: $320k x 0.30 = $ 96,000
  Month 2: $320k x 0.60 = $192,000
  Month 3: $320k x 0.90 = $288,000
  Q3 total contribution: $576,000 / 3 months = avg $192k/mo

Revised ramped capacity (Q3 average):
  Existing team: $1,920,000
  New Enterprise (avg): $360,000
  New Mid-market (avg): $192,000
  Total: $2,472,000

Pipeline capacity needed: $4,000,000 x 3x = $12,000,000
Gap after hiring: hiring improves but does not close gap in Q3.
Gap closes when both hires reach full ramp (month 4+) and if remaining
open roles are filled.

Recommendation: fill both roles immediately; gap-closure timeline is Q4
if headcount is complete by Q3 month 1 and ramp support is in place
(rep-onboarding).
```

**No gap scenario:**

```text
Request: "Capacity check for Q1, enterprise segment only."

Enterprise quota (rules/targets.md): $1,200,000
Coverage target: 3x
Enterprise ramped capacity: $1,200,000 (2 fully ramped reps at $600k each)
Pipeline capacity needed: $1,200,000 x 3x = $3,600,000

Enterprise team can generate $1,200,000 x 3 = $3,600,000 of pipeline
at full efficiency. No capacity gap for Q1 enterprise segment at current
headcount, assuming both reps are fully ramped.

Note: if either enterprise rep departs or slips to ramp, this changes.
Monitor open headcount monthly.
```

---

## Anti-patterns

- **Using full quota for partially-ramped reps.** This is the most common
  capacity-planning error. A rep in ramp month 1 contributes their ramp
  factor (e.g., 30%) of full quota, not 100%. Ignoring this inflates capacity
  and hides the true gap.
- **Hardcoding the coverage multiple.** The pipeline-coverage target lives in
  `rules/targets.md`. Read the rule; do not embed a fixed multiple inline that
  can drift from the configured value.
- **Smoothing a gap into a "stretch" framing.** Per `rules/targets.md`:
  capacity gaps are surfaced, not hidden. If quota exceeds ramped capacity x
  coverage target, say so in dollars and rep-equivalents. Do not reframe it
  as "ambitious" or imply the team just needs to work harder.
- **Counting open headcount as capacity.** An approved but unfilled role
  contributes zero pipeline capacity. Open headcount is a risk factor, not a
  capacity asset.
- **Confusing attainment capacity with pipeline-coverage capacity.**
  Ramped capacity tells you what the team can close; pipeline-coverage capacity
  tells you what they need to generate to make closing likely. These are
  related but distinct. The gap formula uses ramped_capacity x coverage_multiple,
  not ramped_capacity alone.
- **Projecting ramp contributions at full quota from day 1.** Ramp schedules
  from `rules/targets.md` are month-by-month. A new hire starting in Q3 month
  1 closes the gap in a future quarter, not immediately. State the timeline
  explicitly.

## Related

- Quota, ramp schedule, coverage target: `rules/targets.md` (DEFER for all
  numbers; do not duplicate thresholds inline).
- Segment quota allocation: `rules/segments/enterprise.md`,
  `rules/segments/mid-market.md`, `rules/segments/smb.md`.
- New rep ramp support: `rep-onboarding` (ramp acceleration inputs).
- Period attainment reporting: `sales-reporting` (Mode 2 pipeline-coverage
  check at current state; capacity-planning is the forward-looking headcount
  model).
- CRM reads: `pipeline-auditor` (reads the rep roster and ramp dates from
  HubSpot; read-only).
- Analytics: `metrics-analyst` (read-only; computes capacity math from the
  pipeline-auditor tool-result; does NOT query HubSpot directly).
- CRM writes: `crm-operator` (sole writer; headcount record updates route
  here).
- Command: `/capacity`.
