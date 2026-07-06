---
name: sales-reporting
description: >-
  Canonical RevOps metric rollup — funnel, pipeline coverage, attainment, rep
  scorecards, board narrative. Trigger: 'funnel report', 'pipeline coverage',
  'quota attainment', 'rep scorecard'.
origin: ESCC
---

# Sales Reporting

The canonical RevOps metric rollup for ESCC. Four modes -- Funnel Analysis,
Pipeline Coverage, Board Narrative, and Rep Scorecard -- share one skill so
definitions stay consistent. Select the mode that fits the request; combine
modes when a review needs multiple lenses.

> **Canonical owner:** this skill defines the rep-scorecard scale (distinct
> from MEDDPICC red/amber/green and ICP 0-100). All other skills cite
> sales-reporting for the scorecard rubric.
>
> **Governing rules:**
> `rules/targets.md` -- quota, pipeline-coverage target (3-4x), and activity
> targets. This skill DEFERS to that rule for all threshold numbers; it does
> not duplicate them inline.
> `rules/lifecycle-stages.md` -- canonical funnel (Subscriber/Lead -> MQL ->
> SAL -> SQL; deal stages 1-5). Stage conversions use exactly these stages.
> `rules/common/forecasting-definitions.md` -- Commit / Best case / Pipeline /
> Omitted/Closed categories. Use exact names.
> `product-knowledge` -- any metric, ROI figure, or customer reference cited in
> a board-narrative mode output must exist in an approved product-knowledge
> entry. Never fabricate.
>
> **Execution:** the `pipeline-auditor` agent pulls stage volumes, activity,
> and opportunity records from HubSpot (read-only); the `forecast-analyst`
> agent pulls forecast-category data from HubSpot (read-only). The
> `metrics-analyst` agent performs read-only analysis and rollup on those
> tool-results -- it does NOT query HubSpot directly. All CRM writes route
> through `crm-operator` only.

## When to Activate

Activate this skill when:

- A RevOps analyst, Sales Manager, or CRO wants a **funnel conversion report**
  -- stage-by-stage conversion rates, volume, and cycle time.
- A manager checks whether the team has enough **pipeline-coverage** to hit
  the period quota (pipeline-coverage ratio = open pipeline $ / quota).
- A leader needs a **board or executive narrative** -- a period performance
  summary with proof-backed claims for a board deck or investor update.
- A manager reviews a **rep scorecard** -- attainment, activity, pipeline
  health, and forecast discipline for a single rep.
- The `/report` command is invoked (any mode), or `/quota` is invoked for the
  self-scoped rep-scorecard attainment view.

Do **not** use this skill to:
- Forecast a specific deal (that is `forecast-rollup`).
- Score an individual deal's MEDDPICC health (that is `deal-review`).
- Review a single account's renewal health (that is `renewal-playbook`).
- Run a QBR narrative (that is `qbr-builder`, which consumes this skill's output).

---

## Mode 1: Funnel Analysis

Converts the canonical lifecycle stages into a conversion waterfall. Measures
volume, conversion rate, and average cycle time at every gate.

### Steps

1. **Set the period and scope.** Confirm: period (quarter, month, custom),
   segment filter (enterprise / mid-market / SMB per `rules/segments/*`),
   and whether to include all reps or a named subset.

2. **Pull stage volumes.** The `pipeline-auditor` agent pulls lead/deal counts
   entering and exiting each lifecycle gate during the period from HubSpot
   (read-only); `metrics-analyst` computes the funnel conversion from that
   tool-result:
   - Lead -> MQL (volume in, volume converted, rate, avg days)
   - MQL -> SAL (volume, accept rate, reject rate, avg response time vs. SLA)
   - SAL -> SQL (volume, conversion rate, avg days)
   - SQL -> Stage 1 Discovery (implicit at opportunity creation)
   - Stage 1 -> 2 -> 3 -> 4 -> Closed Won (volume and rate at each step)
   - Closed Won vs. Closed Lost split and reasons

3. **Compute conversion rates and cycle times.** Rate = exits / entries per
   gate. Cycle time = median days between stage entry and exit for won deals.
   Flag any gate where conversion is below the segment benchmark
   (benchmarks deferred to `rules/targets.md` and `rules/segments/*`).

4. **Identify the largest drop-off gate.** The gate with the lowest conversion
   rate is the primary constraint. Surface it explicitly -- this is the first
   coaching lever.

5. **Return the waterfall.** Present each stage row: entries, exits,
   conversion%, median cycle time, delta vs. prior period. Highlight the
   drop-off gate and any SLA miss at MQL -> SAL.

### Example

```text
Request: "Run a Q2 funnel report for the mid-market segment."

metrics-analyst rollup (from pipeline-auditor tool-result):

Funnel: Mid-Market, Q2 2026

Stage gate         | In   | Out  | Rate  | Median days | vs Q1
-------------------|------|------|-------|-------------|-------
Lead -> MQL        | 842  | 312  | 37%   | 4           | -3pp
MQL -> SAL         | 312  | 268  | 86%   | 1.2         | +2pp
SAL -> SQL         | 268  | 104  | 39%   | 9           | -6pp
SQL -> Stage 2     | 104  | 81   | 78%   | 14          | +1pp
Stage 2 -> Stage 3 | 81   | 44   | 54%   | 21          | -8pp
Stage 3 -> Stage 4 | 44   | 31   | 70%   | 18          | flat
Stage 4 -> Won     | 31   | 19   | 61%   | 22          | -4pp

Closed Won: 19  |  Closed Lost: 12  |  Win rate: 61%

Largest drop-off: SAL -> SQL (39%), down 6pp vs Q1.
Primary constraint: qualification gate. Reps accepting leads that do not
reach SQL. Coaching lever: ICP fit at SAL accept decision (icp-profile).
MQL -> SAL SLA: 1.2 days median -- within target.
```

---

## Mode 2: Pipeline Coverage

Checks whether the current open pipeline provides sufficient coverage to hit
the period quota. Pipeline-coverage ratio = open pipeline $ / period quota.

> **Qualified term:** always write "pipeline-coverage ratio" in full on first
> use in any output. Never use bare "coverage" -- that word is reserved and
> must always be qualified (pipeline-coverage, territory coverage, or committee
> coverage per CLAUDE.md collision-word reservations).

### Steps

1. **Pull period quota.** Defer to `rules/targets.md` for the quota number.
   Use team quota if reporting at team level; rep quota if per-rep.

2. **Pull open pipeline.** The `forecast-analyst` agent pulls all open
   opportunities expected to close in the period from HubSpot (read-only);
   `metrics-analyst` computes the coverage figures from that tool-result:
   - Gross pipeline $ (all open deals in period)
   - Forecast-category breakdown: Commit / Best case / Pipeline
     (exact names from `rules/common/forecasting-definitions.md`)
   - Stage distribution of the pipeline

3. **Compute pipeline-coverage ratio.** pipeline-coverage ratio = open
   pipeline $ / period quota. Compare against the target multiple from
   `rules/targets.md` (commonly 3-4x -- defer to that rule; do not hardcode).

4. **Compute commit + best-case coverage.** Commit $ + Best-case $ / quota.
   This is the "likely range" view. Surface shortfall if Commit alone does
   not cover quota.

5. **Flag gaps.** If pipeline-coverage ratio is below the target multiple,
   surface the gap amount: quota - (pipeline$ / coverage_target_multiple).
   Do not hide this -- per `rules/targets.md`, gaps are surfaced, not papered.

6. **Return the coverage summary.** Table: quota, pipeline by category,
   pipeline-coverage ratio, commit coverage, best-case coverage, gap vs.
   target multiple (if any). Flag segment or rep-level gaps where the
   data supports it.

### Example

```text
Request: "Pipeline coverage check, full team, Q3."

Period quota (rules/targets.md): $4,200,000

Open pipeline by forecast category:
  Commit:     $1,050,000
  Best case:  $  880,000
  Pipeline:   $1,420,000
  Total:      $3,350,000

Pipeline-coverage ratio: $3,350,000 / $4,200,000 = 0.80x
Target multiple (rules/targets.md): 3-4x
GAP: pipeline-coverage ratio is 0.80x vs. 3x minimum target.
     Shortfall to 3x: $9,250,000 of additional qualified pipeline needed.

Commit coverage: $1,050,000 / $4,200,000 = 0.25x (25% of quota in Commit)
Commit + Best-case coverage: $1,930,000 / $4,200,000 = 0.46x

Assessment: Severe pipeline deficit. At current stage-conversion rates
(funnel-analysis mode), close rate from pipeline implies $1.9M--$2.6M of
attainment -- a 38%--62% attainment range. Pipeline generation is the
primary lever this quarter.
```

---

## Mode 3: Board Narrative

Produces an executive-ready period performance summary: attainment, pipeline
health, key wins, and forward outlook. Designed for board decks, investor
updates, or QBR executive summaries.

> **Evidence rule (CRITICAL):** every metric, ROI claim, and customer
> reference in a board narrative must be backed by either (a) a HubSpot
> tool-result (via `pipeline-auditor` or `forecast-analyst`) analyzed by
> `metrics-analyst`, or (b) an approved `product-knowledge` entry. Never
> fabricate a customer name, revenue figure, or benchmark. If proof is
> missing, mark the claim [UNVERIFIED -- do not include] and surface the
> gap to the requestor before publishing.

### Steps

1. **Gather period metrics.** Run Mode 1 (funnel) and Mode 2 (coverage) first.
   Pull attainment: Closed Won $ / quota. Pull net-new logo count. Pull
   average deal size and cycle time for the period.

2. **Select 2-3 key wins.** The `pipeline-auditor` agent pulls Closed Won
   deals for the period from HubSpot; `metrics-analyst` identifies the most
   notable by ACV or strategic segment.
   Use company name only if the deal is in HubSpot as Closed Won -- do not
   reference a deal that has not closed. Do not fabricate proof.

3. **Draft the narrative sections.**
   - **Attainment:** period quota, Closed Won $, attainment% vs. target.
   - **Pipeline health:** pipeline-coverage ratio (qualified) and Commit/
     Best-case outlook vs. next period quota.
   - **Key wins:** 2-3 named wins with ACV and segment. Proof-backed only.
   - **Leading indicators:** MQL volume, SQL creation rate, pipeline added --
     forward signal for next period.
   - **Risks and actions:** top 1-2 gaps (coverage deficit, conversion drop-
     off, capacity gap) with the action already in flight.

4. **Proof-check before returning.** Scan every claim: does it have a
   tool-result or approved product-knowledge citation? Flag any unverified
   claim. Do not send a board narrative with fabricated numbers.

5. **Return in board-ready format.** Bullet points under each section header.
   Keep language plain. Executives read summaries; the detail lives in the
   appendix (funnel and coverage tables from Modes 1 and 2).

### Example

```text
Request: "Board narrative for Q2 2026."

BOARD NARRATIVE -- Q2 2026

Attainment
- Q2 quota: $3,800,000 | Closed Won: $3,230,000 | Attainment: 85%
- Enterprise segment: 102% attainment. Mid-market: 74% (constraint: SAL->SQL
  conversion, down 6pp -- coaching in progress).

Key Wins (Closed Won, verified HubSpot tool-result)
- Acme Corp: $210,000 ACV, enterprise, closed 2026-06-14
- BetaInc: $88,000 ACV, mid-market, closed 2026-06-28
- [Third win pending -- tool-result shows no other deal >$50k closed this
  quarter. Do not fabricate a third example.]

Pipeline Health (Q3 forward)
- Pipeline-coverage ratio: 2.6x vs. 3-4x target (rules/targets.md) -- deficit.
- Commit: $980,000 | Best case: $740,000 | Combined: $1,720,000 vs.
  $4,000,000 Q3 quota.
- Action: pipeline generation sprint launched week of 2026-06-30; SDR
  activity targets increased 20% for July (rules/targets.md activity model).

Leading Indicators
- MQLs created in Q2: 312 (mid-market) -- flat vs. Q1. SQL creation: 104 --
  down 6% QoQ. Signal: top-of-funnel holding; mid-funnel qualification gap.

Risks
1. Mid-market pipeline-coverage ratio below target -- primary revenue risk.
2. Two enterprise deals slipped from Q2 to Q3 ($380k combined) -- in Commit
   for Q3 with mutual plans in place.
```

---

## Mode 4: Rep Scorecard

A per-rep performance view combining attainment, activity, pipeline health,
and forecast discipline. Distinct from MEDDPICC scoring (that is deal-level,
red/amber/green) and from ICP scoring (that is 0-100 account fit).

> **Scale definition (canonical owner):** the rep scorecard uses a
> 1-5 rating scale, defined here. Other skills do not define a competing
> rep-performance scale.
>
> | Rating | Label | Description |
> |--------|-------|-------------|
> | 5 | Exceeds | >= 100% attainment; activity at or above target; pipeline-coverage ratio at or above target; Commit forecast accurate to +/- 10% |
> | 4 | On track | 85-99% attainment; activity within 10% of target; pipeline-coverage ratio >= 2.5x; forecast accuracy +/- 20% |
> | 3 | Developing | 70-84% attainment; activity 75-90% of target or pipeline light; one material gap (coverage or activity) |
> | 2 | At risk | 50-69% attainment or pipeline-coverage ratio below 2x or persistent forecast miss |
> | 1 | Urgent coaching | Below 50% attainment; activity below 75% of target; pipeline critically thin |
>
> Ratings are calibrated inputs for `coaching-prep` -- they are not punitive
> labels. A rating-2 or rating-1 rep triggers a `coaching-prep` workflow.

### Steps

1. **Set scope.** Rep name, period, segment (determines activity targets per
   `rules/segments/*` and quota per `rules/targets.md`).

2. **Pull attainment.** Closed Won $ for the period vs. rep quota (from
   `rules/targets.md`). Compute attainment %.

3. **Pull activity metrics.** The `pipeline-auditor` agent reads logged
   activities from HubSpot: dials, meaningful conversations, meetings held,
   opportunities created; `metrics-analyst` computes the attainment against
   segment activity targets (`rules/targets.md`, `rules/segments/*`).

4. **Pull pipeline health.** Rep's open pipeline $, pipeline-coverage ratio
   (rep pipeline $ / rep quota), and forecast-category breakdown (Commit /
   Best case / Pipeline -- exact names).

5. **Pull forecast discipline.** Compare rep's Commit calls from prior periods
   against actual Closed Won. Flag if Commit forecast accuracy is outside
   +/- 20% consistently (see `forecast-accuracy` skill for deeper analysis).

6. **Assign a 1-5 scorecard rating.** Apply the scale above. Surface the
   primary driver of the rating (attainment gap, activity gap, pipeline gap,
   or forecast miss). Provide the 1-2 top coaching actions.

7. **Return the scorecard.** Rating, rating label, attainment, activity,
   pipeline-coverage ratio, forecast accuracy, primary gap, and coaching
   actions. Route the coaching actions to `coaching-prep`.

> **Self-scoped view (/quota command):** when a rep invokes `/quota`, this
> mode runs scoped to their own HubSpot owner ID. The rep sees their own
> attainment, pipeline-coverage ratio, and rating -- not other reps' data.

### Example

```text
Request: "Scorecard for Jamie Chen, Q2 2026, mid-market segment."

metrics-analyst rollup (from pipeline-auditor tool-result):

Rep: Jamie Chen | Period: Q2 2026 | Segment: Mid-market

Attainment:
  Quota (rules/targets.md): $320,000
  Closed Won: $244,000
  Attainment: 76%

Activity (rules/targets.md + rules/segments/mid-market.md targets):
  Dials: 412 vs. 500 target (82%)
  Meaningful conversations: 61 vs. 75 target (81%)
  Meetings held: 18 vs. 20 target (90%)
  Opportunities created: 7 vs. 8 target (88%)

Pipeline (open, Q3 close):
  Pipeline $: $480,000
  Rep quota Q3: $340,000
  Pipeline-coverage ratio: 1.4x (target: 3-4x per rules/targets.md)
  Commit: $90,000 | Best case: $120,000 | Pipeline: $270,000

Forecast discipline (last 2 periods):
  Commit called: $310,000 | Closed Won: $244,000 | Miss: -21%
  Trend: consistent over-forecasting in Commit category.

SCORECARD RATING: 2 -- At risk
  Primary gap: pipeline-coverage ratio (1.4x vs. 3-4x target) and attainment
  at 76%. Activity is acceptable but pipeline is critically thin.
  Forecast discipline: consistent Commit over-call -- separate coaching input.

Coaching actions (route to coaching-prep):
  1. Pipeline generation sprint: identify 4-6 additional ICP-fit targets this
     week. Activity is near target; pipeline creation is the gap.
  2. Commit calibration conversation: review Commit criteria vs.
     rules/common/forecasting-definitions.md. Commit requires mutual plan,
     confirmed paper path, and economic buyer engaged.
```

---

## Anti-patterns

- **Deriving stage names from context.** Stage names are canonical:
  Subscriber/Lead -> MQL -> SAL -> SQL; deal stages 1-5 (Discovery,
  Qualification, Validation/Proof, Proposal/Negotiation, Closed Won/Lost).
  Using ad-hoc names ("prospecting", "demo stage") breaks cross-report
  consistency. Always use `rules/lifecycle-stages.md` names.
- **Bare "coverage".** Always qualify: "pipeline-coverage ratio", "territory
  coverage", or "committee coverage". Bare "coverage" is reserved and
  ambiguous.
- **Hardcoding the coverage multiple.** The pipeline-coverage target (3-4x)
  is in `rules/targets.md`. Read it; do not embed a number that can drift.
- **Fabricating board-narrative claims.** Every metric and customer reference
  in Mode 3 must be a HubSpot tool-result or an approved product-knowledge
  entry. An unverified claim in a board deck is a trust-destroying error.
- **Conflating rep-scorecard ratings with MEDDPICC.** MEDDPICC is red/amber/
  green at the deal level (deal-review). The rep scorecard is 1-5 at the rep
  level (this skill). They measure different things; never use MEDDPICC
  language to describe rep performance or vice versa.
- **Using Mode 4 data across reps when /quota is invoked.** The self-scoped
  `/quota` command shows a rep their own data only. Never surface other reps'
  attainment or scorecard ratings to a non-manager caller.
- **Reporting without a tool-result.** If `pipeline-auditor` or
  `forecast-analyst` returns no data for a period (empty HubSpot query),
  surface the data gap -- do not fabricate plausible numbers to fill the
  table.

## Related

- Quota and target definitions: `rules/targets.md` (DEFER; do not duplicate).
- Canonical funnel stages: `rules/lifecycle-stages.md`.
- Forecast categories: `rules/common/forecasting-definitions.md`.
- Board-narrative proof: `product-knowledge` (approved claims only).
- Deal-level health: `deal-review` (MEDDPICC, separate from this skill).
- Portfolio NRR/GRR/churn: `retention-rollup` (separate; cite by name).
- Forecast accuracy deep-dive: `forecast-accuracy`.
- Forecast roll-up: `forecast-rollup`.
- Coaching input from scorecard: `coaching-prep` (receives rating + gaps).
- QBR executive summary: `qbr-builder` (consumes Mode 1, 2, and 3 output).
- Segment activity targets: `rules/segments/enterprise.md`,
  `rules/segments/mid-market.md`, `rules/segments/smb.md`.
- CRM reads: `pipeline-auditor` (pipeline, activity, and opportunity records),
  `forecast-analyst` (forecast-category data). Both are read-only.
- Analytics: `metrics-analyst` (read-only; analyzes tool-results from the
  CRM-read agents; does NOT query HubSpot directly; no CRM writes).
- CRM writes: `crm-operator` (sole writer; all HubSpot updates route here).
- Commands: `/report` (any mode) and `/quota` (Mode 4, self-scoped).
