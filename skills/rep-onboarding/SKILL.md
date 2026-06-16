---
name: rep-onboarding
description: >-
  Use when a new sales rep needs a structured ramp plan, 30/60/90 milestone
  targets, and certification checkpoints. Trigger on "onboard a rep", "ramp
  plan", "30/60/90", "new hire certification", "what should a new rep do in
  their first 90 days", "build a ramp plan for <rep name>", "what are the
  certification milestones for new reps", or any request to structure a new
  rep's entry into quota-carrying territory. Ramp months (30/60/90) are
  distinct from pipeline stages -- never call a ramp month a "stage".
origin: ESCC
---

# Rep Onboarding

Builds and manages a 30/60/90 ramp plan for a new sales rep: structured
learning milestones, certification checkpoints, activity targets calibrated
to the ramp schedule, and a first-pipeline build guide. Ramp quota is reduced
during ramp months per `rules/targets.md`; this skill surfaces the plan and
tracks progress against it.

> **Governing rules:** `rules/targets.md` (ramp schedule, reduced quota per
> ramp month, and activity targets per segment -- the authoritative source;
> defer to those figures, do not invent local targets), `playbook-library`
> (what plays and plays the rep must drill to certify), `product-knowledge`
> (certification content and approved proof points -- never fabricate product
> claims).
>
> **Terminology discipline:** ramp months are called ramp months (30/60/90).
> "Stage" means pipeline stage only -- a deal's position in the funnel
> (`rules/lifecycle-stages.md`). Do not call ramp month 1 a "stage 1" or a
> "phase" of the funnel. "Ramp month" is the term.
>
> **No writes from this skill.** Ramp plan delivery is read/build only. Any
> CRM record updates (e.g. logging onboarding activities, creating the rep's
> HubSpot user profile) route through `crm-operator`. This skill does not write
> to HubSpot and does not claim a record was updated without a tool-result.

## When to Activate

Activate this skill when:

- A new rep is starting and a manager asks for their 30/60/90 ramp plan.
- "Build a ramp plan for [rep name]" or "what are the certification milestones"
  is the request.
- A rep wants to understand what is expected of them in their first 90 days.
- A manager wants to review a rep's ramp progress at the 30, 60, or 90-day
  mark.

Do **not** activate for an established rep's quarterly plan (use `coaching-prep`
and `territory-planning`). Do not use this skill to set or change quota --
quota and ramp schedules are defined in `rules/targets.md`; this skill reads
and applies them. Do not use it to write performance review documentation.

## Ramp Plan Structure

A rep ramp plan has three ramp months. Each ramp month has:

1. **Learning milestones** -- what the rep must learn and demonstrate.
2. **Certification checkpoints** -- formal sign-off that a milestone is met.
3. **Activity targets** -- leading-indicator targets calibrated to the ramp
   month (lower in ramp month 1, ramping up). Targets per segment from
   `rules/targets.md`.
4. **Pipeline build targets** -- how many opportunities should exist in the
   rep's pipeline by the end of the ramp month.
5. **Manager check-in cadence** -- how often manager and rep meet during ramp.

Ramp quota (reduced quota per ramp month) is set in `rules/targets.md`.
Capacity math (what this rep contributes to team coverage) uses ramped quota,
not full quota, for the ramp period (`capacity-planning`).

## Workflow

### 1. Gather rep context

Accept:

- Rep name, segment assignment (enterprise / mid-market / SMB), and start date.
- Territory or named accounts assigned (if known).
- Prior sales experience level: new to sales, experienced AE new to segment,
  lateral transfer from another role.
- Manager name and preferred check-in cadence.

Segment determines activity targets (from `rules/targets.md`) and the depth
of MEDDPICC qualification expected by the end of each ramp month.

### 2. Pull ramp quota and activity targets from rules/targets.md

Do not invent quota or targets. Read:

- Ramp quota for each ramp month (e.g. 0% / 33% / 66% of full quota in ramp
  months 1 / 2 / 3, exact figures from `rules/targets.md`).
- Activity targets per segment per ramp month.
- Pipeline coverage target by ramp month end.

State these figures as "per `rules/targets.md`" throughout the plan. If a
specific rep's quota or target is not yet loaded, flag it and note that the
manager must confirm the figures from `rules/targets.md` before the plan is
finalised.

### 3. Build the ramp month 1 plan (days 1-30)

**Learning milestones:**
- Complete product knowledge certification: core product areas, demo readiness,
  approved proof points and ROI claims. Content owned by `product-knowledge`;
  rep must demonstrate knowledge via certification quiz or manager sign-off --
  never rely on unverified product claims.
- Learn the sales process: funnel stages (`rules/lifecycle-stages.md`), deal
  progression criteria, CRM hygiene expectations (`rules/common/crm-hygiene.md`).
- MEDDPICC orientation: read `rules/meddpicc/qualification.md` and complete at
  least one deal-review shadow session with a senior rep or manager.
- Playbook orientation: review the core plays relevant to segment. Content
  owned by `playbook-library` -- cite the plays by name; do not paraphrase
  playbook content into this plan.
- ICP and persona: review `icp-profile` for target company and buyer profiles.

**Certification checkpoints (ramp month 1):**
- [ ] Product knowledge quiz passed (or manager-assessed) -- `product-knowledge`
- [ ] Demo delivered solo (rough pass acceptable) -- manager sign-off
- [ ] CRM record created for 3 practice accounts with all required fields
      (`rules/common/crm-hygiene.md`) -- manager review
- [ ] MEDDPICC field definitions named without prompting -- manager quiz

**Activity targets (ramp month 1):**
- Per `rules/targets.md` ramp month 1 targets for [segment].
- Focus: outreach volume and first meetings booked. Pipeline creation expected
  to be minimal -- this is a learning-first ramp month.

**Pipeline build target (end of ramp month 1):**
- Per `rules/targets.md`. Typically: first qualified opportunities created
  (exact number per target rule).

**Manager check-in cadence (ramp month 1):**
- Recommend: daily stand-up or EOD check-in (15 min) for the first two weeks;
  move to 3x/week in weeks 3-4. Weekly formal 1:1 (30-45 min) throughout.
- Use `coaching-prep` to prepare for each formal 1:1 during ramp.

### 4. Build the ramp month 2 plan (days 31-60)

**Learning milestones:**
- Discovery mastery: rep can run an unassisted discovery call and capture
  MEDDPICC fields with evidence.
- Objection handling: rep has reviewed the core objection responses in
  `playbook-library` and can demonstrate them in a role-play.
- Competitive positioning: rep knows the top 2-3 competitors in their segment;
  approved differentiation from `playbook-library` (do not fabricate competitive
  claims -- source from playbook only).
- Demo polish: rep can deliver a segment-appropriate demo independently,
  anchored to a buyer's stated pain.
- First pipeline review: manager runs a `deal-review` session on the rep's
  early-stage deals together.

**Certification checkpoints (ramp month 2):**
- [ ] Discovery call certification: rep runs a role-play discovery; manager
      scores using `call-review` scale; minimum Developing (10/15) required
- [ ] Objection handling role-play: manager sign-off on top 3 objections
- [ ] Demo certification: rep delivers full demo solo; manager sign-off
- [ ] First deal reviewed in `deal-review` with MEDDPICC fields populated
      with evidence

**Activity targets (ramp month 2):**
- Per `rules/targets.md` ramp month 2 targets for [segment].
- Expect: meetings booked and opportunities moving to Stage 2+.

**Pipeline build target (end of ramp month 2):**
- Per `rules/targets.md`. Typically: pipeline coverage at [X]% of ramp month 2
  quota target.

**Manager check-in cadence (ramp month 2):**
- Recommend: 2x/week informal check-in (15 min); weekly formal 1:1 (45 min)
  using `coaching-prep`. First formal call review using `call-review` on one
  of the rep's discovery calls.

### 5. Build the ramp month 3 plan (days 61-90)

**Learning milestones:**
- Full pipeline ownership: rep manages a full pipeline with no hand-holding;
  can present their own deals in a pipeline review meeting.
- Forecast readiness: rep can commit a deal to forecast with MEDDPICC evidence
  per `deal-review` rubric.
- Multi-threading: rep has mapped buying committees for at least two deals
  (`stakeholder-mapping`).
- Negotiation and close mechanics: rep has reviewed the close plays in
  `playbook-library`.

**Certification checkpoints (ramp month 3):**
- [ ] Pipeline review certification: rep presents 3+ deals in a pipeline review;
      manager assesses MEDDPICC quality; all critical elements evidenced
- [ ] First forecast submission: rep submits a commit with supporting evidence;
      `deal-review` run together with manager
- [ ] Stakeholder map completed for at least one active deal (`stakeholder-mapping`)
- [ ] Full-ramp readiness sign-off: manager formal sign-off that rep is ready
      to carry full quota from ramp month 4 forward

**Activity targets (ramp month 3):**
- Per `rules/targets.md` ramp month 3 targets for [segment].
- Approaching full-quota activity expectations by end of ramp month 3.

**Pipeline build target (end of ramp month 3):**
- Per `rules/targets.md`. Typically: full-quota pipeline coverage ratio
  ([X]x quota) or close to it.

**Manager check-in cadence (ramp month 3):**
- Move to standard cadence: weekly 1:1 using `coaching-prep`, biweekly pipeline
  review using `deal-review`. Ramp check-ins wind down.

### 6. Return the ramp plan

Return a structured ramp plan document the manager and rep can work from:

- Cover: rep name, segment, start date, manager, full-quota start date (day 91+).
- Ramp month 1 / 2 / 3 sections with milestones, checkpoints, activity targets
  (sourced from `rules/targets.md`), pipeline targets, and check-in cadence.
- Certification tracker table (all checkpoints in one view, columns: checkpoint
  / owner / target date / status).
- A "ramp complete" criteria summary: what must be true on day 90 for the
  manager to sign off full-quota readiness.

## Examples

**Enterprise AE ramp plan request:**

```text
manager: "build a 30/60/90 for Jordan -- new enterprise AE, starting June 16"

RAMP PLAN: Jordan Lee -- Enterprise AE
Start: 2026-06-16 | Full quota: 2026-09-16 (day 91)
Manager: [Manager name] | Segment: Enterprise

RAMP QUOTA (rules/targets.md):
  Ramp month 1 (to 2026-07-15): [per targets.md ramp month 1 -- manager to confirm]
  Ramp month 2 (to 2026-08-15): [per targets.md ramp month 2]
  Ramp month 3 (to 2026-09-15): [per targets.md ramp month 3]

RAMP MONTH 1 (2026-06-16 to 2026-07-15) -- Learn
  Milestones: product knowledge, sales process, MEDDPICC orientation,
    playbook-library review (enterprise segment plays), ICP and persona
    (icp-profile enterprise tier)
  Checkpoints:
    [ ] Product knowledge quiz -- product-knowledge -- by 2026-06-27
    [ ] CRM practice records (3 accounts) -- crm-hygiene -- by 2026-06-30
    [ ] MEDDPICC field definitions quiz -- manager -- by 2026-07-05
    [ ] First demo (rough pass) -- manager sign-off -- by 2026-07-10
  Activity targets: per rules/targets.md ramp month 1, enterprise segment
  Pipeline target: [per rules/targets.md] -- typically first 2-3 qualified opps
  Check-in: daily stand-up weeks 1-2; 3x/week weeks 3-4; weekly 1:1 throughout

RAMP MONTH 2 (2026-07-16 to 2026-08-15) -- Execute
  Milestones: discovery certification, objection handling, competitive
    positioning (playbook-library), demo polish, first deal-review session
  Checkpoints:
    [ ] Discovery call certification (call-review, min 10/15) -- by 2026-07-31
    [ ] Objection handling role-play (top 3) -- manager -- by 2026-08-05
    [ ] Demo certification -- manager -- by 2026-08-10
    [ ] First MEDDPICC-evidenced deal-review -- manager -- by 2026-08-15
  Activity targets: per rules/targets.md ramp month 2, enterprise segment
  Pipeline target: [per rules/targets.md ramp month 2 coverage ratio]
  Check-in: 2x/week informal; weekly 1:1 (coaching-prep); first call-review

RAMP MONTH 3 (2026-08-16 to 2026-09-15) -- Own
  Milestones: full pipeline ownership, forecast submission, multi-threading
    (stakeholder-mapping on 2+ deals), close mechanics (playbook-library)
  Checkpoints:
    [ ] Pipeline review certification (3+ deals, MEDDPICC evidenced) -- by 2026-09-01
    [ ] First forecast commit with evidence -- by 2026-09-08
    [ ] Stakeholder map on 1+ active deal -- stakeholder-mapping -- by 2026-09-10
    [ ] Full-ramp readiness sign-off -- manager -- by 2026-09-15
  Activity targets: per rules/targets.md ramp month 3, enterprise (approaching full)
  Pipeline target: full-quota pipeline coverage ratio per rules/targets.md
  Check-in: weekly 1:1 (coaching-prep), biweekly pipeline review (deal-review)

CERTIFICATION TRACKER:
  Checkpoint                      | Owner   | Target date | Status
  Product knowledge quiz          | rep     | 2026-06-27  | [ ]
  CRM practice records            | rep     | 2026-06-30  | [ ]
  MEDDPICC quiz                   | manager | 2026-07-05  | [ ]
  Demo (rough pass)               | manager | 2026-07-10  | [ ]
  Discovery certification         | manager | 2026-07-31  | [ ]
  Objection role-play             | manager | 2026-08-05  | [ ]
  Demo certification              | manager | 2026-08-10  | [ ]
  First evidenced deal-review     | manager | 2026-08-15  | [ ]
  Pipeline review certification   | manager | 2026-09-01  | [ ]
  First forecast commit           | manager | 2026-09-08  | [ ]
  Stakeholder map (1 deal)        | rep     | 2026-09-10  | [ ]
  Full-ramp readiness sign-off    | manager | 2026-09-15  | [ ]

RAMP COMPLETE CRITERIA:
  On 2026-09-15, Jordan is ready for full quota when:
  - All 12 checkpoints are signed off
  - Pipeline coverage is at full-quota target (rules/targets.md)
  - At least one deal is commit-ready per deal-review rubric
  - Manager has completed ramp readiness sign-off
```

**Progress check at day 45:**

```text
manager: "Jordan is at day 45 -- how is she tracking on ramp?"

Retrieve certification tracker status for Jordan (coaching-analyst pulls HubSpot
  activity and any logged certification completions).

Ramp month 1 checkpoints: 4/4 complete (on schedule).
Ramp month 2 checkpoints: 1/4 complete (discovery certification passed 2026-07-28).
  Outstanding: objection role-play, demo certification, first deal-review.
  Target dates in 18 days or less -- at risk if not scheduled immediately.

Activity vs. targets (ramp month 2, enterprise, rules/targets.md):
  [report activity vs. targets -- cite activity-audit output]

Coaching signal: demo certification is not yet scheduled. Recommend: book the
  demo certification session this week. Flag for 1:1 (use coaching-prep).

Note: "ramp month 2" refers to Jordan's 31-60 day ramp period -- not a pipeline
  stage. Pipeline stages are per rules/lifecycle-stages.md.
```

## Anti-patterns

- **Calling a ramp month a "stage".** Ramp months (30/60/90) are distinct from
  pipeline stages (`rules/lifecycle-stages.md`). "Jordan is in stage 2 of her
  ramp" is incorrect phrasing. Use "ramp month 2".
- **Inventing quota or activity targets.** All quota, ramp quota, and activity
  targets come from `rules/targets.md`. If those figures are not loaded, flag it
  and ask the manager to confirm -- do not substitute a guess.
- **Fabricating product claims in certification content.** Product certification
  content is owned by `product-knowledge`. Never state a product capability or
  ROI figure that cannot be traced there.
- **Using playbook content without citing the source.** Play descriptions and
  objection responses are owned by `playbook-library`. Reference plays by name;
  do not paraphrase or invent alternatives.
- **Treating the ramp plan as a performance review.** A ramp plan defines
  milestones and checkpoints for a new rep to reach competency. It is not a
  performance improvement plan or a disciplinary document.
- **Skipping the certification checkpoints.** Milestones without checkpoints are
  aspirations. Every ramp month must have manager-sign-off checkpoints or they
  will not close.
- **Claiming CRM records were updated.** Activity logging and rep record creation
  route through `crm-operator`. This skill proposes; crm-operator executes.
- **Using ramp plan targets for a rep who is not in ramp.** An established rep's
  targets come from `rules/targets.md` full-quota figures and are managed via
  `coaching-prep`, not this skill.

## Related

- `rules/targets.md` -- ramp schedule, reduced quota per ramp month, and
  activity targets. The authoritative source. Defer; do not invent local figures.
- `playbook-library` -- plays and objection responses the rep must drill to
  certify. Cite by play name; do not paraphrase content here.
- `product-knowledge` -- certification content and approved proof points for
  product knowledge milestones. Never fabricate product claims.
- `icp-profile` -- target company and buyer profiles used in ramp month 1
  learning.
- `deal-review` -- used in ramp month 2+ certification to assess MEDDPICC
  quality on a rep's early deals.
- `call-review` -- used in ramp month 2 discovery certification (minimum score
  of Developing, 10/15, on the call-review scale).
- `stakeholder-mapping` -- used in ramp month 3 multi-threading certification.
- `coaching-prep` -- the ongoing 1:1 prep skill used throughout ramp (and
  after). Ramp check-ins use coaching-prep as the rep progresses.
- `capacity-planning` -- uses ramped quota (not full quota) for ramp-period
  capacity math. This skill generates the ramp plan; capacity-planning
  consumes the quota figures.
- `rules/meddpicc/qualification.md` -- MEDDPICC field definitions; orientation
  milestone in ramp month 1.
- `rules/lifecycle-stages.md` -- pipeline stages; learning milestone in ramp
  month 1. "Stage" = pipeline stage, not ramp month.
- `crm-operator` (agent) -- sole writer; any CRM activity logging routes here.
- `/onboard` command -- thin shim that delegates to this skill.
