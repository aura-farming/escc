---
name: coaching-prep
description: >-
  Structured coaching brief before a 1:1 — rep pipeline health, activity, call
  patterns. Trigger: 'coaching prep', '1:1 prep', 'prep me to coach <rep>'.
  Strengths cited alongside gaps.
origin: ESCC
---

# Coaching Prep

Prepares a manager for a structured 1:1 or coaching session with a rep. The
`coaching-analyst` agent pulls and synthesises the rep's pipeline, activity log,
and call patterns into a coaching brief; this skill defines what that brief
contains, how it is framed, and what the manager should do with it.

> **Governing rules:** `rules/targets.md` (quota, ramp, and activity targets as
> coaching inputs -- not surveillance), `rules/common/meeting-standards.md`
> (every coaching session ends with an agreed next step).
>
> **Targets are coaching inputs, not surveillance.** Quota attainment, activity
> rate, and pipeline-coverage ratio are signals that focus the conversation -- they do
> not replace judgment, and they are not performance verdicts. Frame numbers as
> evidence for a coaching question, never as a score on the rep as a person.
>
> **No writes from this skill.** Coaching prep is a read/analyse/prep workflow.
> Any CRM update that results from a coaching conversation routes through the
> `crm-operator` agent (sole writer). This skill does not update HubSpot records
> and does not claim any record was updated without a tool-result.

## When to Activate

Activate this skill when:

- A manager says "prep for my 1:1 with [rep name]" or "coaching prep for [rep]".
- A manager wants a brief on a rep's pipeline health, activity trends, or call
  patterns before a scheduled coaching session.
- A manager is running a pipeline review with a rep and needs a structured
  starting point.
- A skip-level or peer coaching session needs a rep-level data brief.

Do **not** activate to produce performance improvement plans or formal HR
documentation -- those require HR process, not a coaching brief. Do not activate
for territory or quota-setting (that is `territory-planning` and
`capacity-planning`). Do not conflate a coaching brief with a forecast
submission -- forecasting is `forecast-rollup`.

## Workflow

### 1. Identify rep and coaching context

Accept from the manager:

- Rep name (or HubSpot user ID).
- Coaching focus if stated: "focus on pipeline hygiene", "I want to work on her
  call quality", "he's struggling to get second meetings". If no focus is stated,
  derive one from the data in step 2.
- Time window: default is the current quarter-to-date plus trailing 30 days of
  activity. Adjust if the manager specifies a period.

### 2. Dispatch coaching-analyst to build the rep brief

The `coaching-analyst` agent (read-only, sonnet) retrieves and structures:

- **Pipeline health:** open opportunities by stage, MEDDPICC completion rates
  per deal, deals with no next step, deals at risk per `deal-review` rubric.
  Cite `deal-review` skill for the MEDDPICC gap analysis -- do not re-derive
  scoring here.
- **Quota and pipeline-coverage ratio:** rep's current attainment vs. period
  quota, pipeline-coverage ratio vs. target. Targets come from
  `rules/targets.md` -- defer to those figures; do not invent a local target.
- **Activity:** cadence and logging compliance vs. segment targets from
  `rules/targets.md`. Cite `activity-audit` for cadence analysis -- this skill
  consumes the output, not the raw logs.
- **Call patterns:** summary of recent call scores from `call-review` outputs
  (if any exist for this rep). Call scores use `call-review`'s own scale --
  do not re-score or re-label calls here; reference the scored output.
- **Stakeholder mapping depth:** for key deals, whether the buying committee is
  mapped. Cite `stakeholder-mapping`.

The `coaching-analyst` returns a structured data brief. This skill then frames it.

### 3. Frame strengths first

Before surfacing gaps, identify at least one genuine strength to anchor.
Strengths must be evidence-backed -- a quote, a closed deal, an activity
metric that is green, a call score that is above baseline. Do not fabricate
positive evidence.

Examples of evidence-backed strengths:

- "Jordan's discovery call scores have improved -- 3 of last 4 calls scored
  'strong' on needs-identification per call-review."
- "Pipeline-coverage ratio is 3.8x quota, above the 3x target (rules/targets.md)."
- "Every deal in Stage 3+ has a documented next step -- meeting-standards
  compliance is 100% this month."

One to two genuine strengths are enough. The goal is accurate framing, not
empty praise.

### 4. Identify 1-2 focus areas with evidence

Limit coaching focus to one or two areas per session. A list of ten things
to improve is not a coaching session; it is noise.

Select focus areas from:

- **Pipeline gaps:** deals with red MEDDPICC elements that the rep can close
  with coaching (e.g. economic buyer not engaged, no champion tested). Cite the
  specific deal and gap from the `deal-review` output.
- **Activity pattern:** cadence below target, or a pattern in WHAT activities
  are being logged (e.g. many emails, few calls) that suggests a skill gap.
  Cite `activity-audit` output and compare to segment targets from
  `rules/targets.md`.
- **Follow-through pattern (v1.8.0):** `escc outcome summary` reports the
  promised-vs-logged follow-up gap folded from recent sessions and
  corroborated against the live promise ledger. Cite it as a coaching input
  only when corroborated — and always alongside strengths, never as
  surveillance.
- **Call quality pattern:** if `call-review` scores show a consistent gap
  (e.g. low discovery depth, talk-to-listen ratio off), name the pattern with
  quoted evidence.
- **Qualification depth:** if MEDDPICC fields are consistently thin or
  unverified, that is a skill gap to coach -- not a data-entry problem.

For each focus area, the brief includes:

- The evidence (deal name, call date, activity metric -- specific, not vague).
- The coaching question to open the conversation (open-ended, not accusatory).
- A suggested next action the manager and rep can agree on in the session.

### 5. Produce the coaching brief

Return a structured brief the manager can use in the 1:1:

```
COACHING BRIEF: [Rep name] -- [Date]
Prepared for: [Manager name]
Window: [e.g. Q2 2026 QTD + trailing 30 days activity]

STRENGTHS (evidence-backed)
- [Strength 1 with source]
- [Strength 2 with source -- optional]

PIPELINE SNAPSHOT
- Open pipeline: $[X] across [N] deals | Stage breakdown: [...]
- Pipeline-coverage ratio: [X]x vs. [target]x target (rules/targets.md)
- Attainment QTD: [X]% of period quota (rules/targets.md)
- Deals at risk: [list deals with deal-review risk flags]
- Deals missing next step: [list -- meeting-standards gap]

ACTIVITY SNAPSHOT (trailing 30 days)
- Meetings booked: [N] vs. [target] target (rules/targets.md, segment: [X])
- Calls logged: [N] | Emails: [N] | Opportunities created: [N]
- Cadence pattern note: [cite activity-audit output]

CALL QUALITY SNAPSHOT
- Calls reviewed (call-review): [N] in window
- Pattern: [summary of call-review scores -- cite call-review scale, not MEDDPICC]

FOCUS AREA 1: [e.g. Economic buyer access]
  Evidence: [specific deal(s), MEDDPICC gap, source]
  Coaching question: "[open-ended question for 1:1]"
  Suggested next action: [who does what by when]

FOCUS AREA 2: [e.g. Discovery depth on new opps]  -- omit if not needed
  Evidence: [specific pattern with source]
  Coaching question: "[open-ended question]"
  Suggested next action: [who does what by when]

SESSION CLOSE (per rules/common/meeting-standards.md)
  Every coaching session ends with an agreed, dated next step between
  manager and rep. Capture it before the call ends.
```

### 6. Return the brief to the manager

Deliver the brief before the scheduled 1:1. Flag if the `coaching-analyst`
could not retrieve sufficient data (e.g. rep has no logged activities this
month -- that itself is a coaching signal to address).

## Examples

**Standard 1:1 coaching prep:**

```text
manager: "prep for my 1:1 with Sarah on Thursday"

coaching-analyst returns brief data for Sarah Chen, Mid-market AE, Q2 QTD.

COACHING BRIEF: Sarah Chen -- 2026-06-19
Window: Q2 2026 QTD + trailing 30 days activity

STRENGTHS
- Pipeline-coverage ratio: 4.1x quota (above 3x target -- rules/targets.md)
- GlobalBank deal (Stage 4): full MEDDPICC mapped, champion tested (per deal-review)

PIPELINE SNAPSHOT
- Open pipeline: $620k across 9 deals
- Coverage ratio: 4.1x vs. 3x target
- Attainment QTD: 38% of $360k period quota (on pace for shortfall)
- Deals at risk: BetaCo ($75k) -- E is red; no economic buyer access in 45 days
- Missing next step: RetailCo ($55k) -- last activity 12 days ago, no next step logged

ACTIVITY SNAPSHOT (trailing 30 days)
- Meetings booked: 7 vs. 10 target (mid-market, rules/targets.md) -- 70%
- Calls logged: 42 | Emails: 118 | Opportunities created: 2
- Pattern: high email volume, below-target meeting rate -- possible avoidance of
  cold outreach channel (cite activity-audit: email-heavy cadence flagged)

CALL QUALITY SNAPSHOT
- 4 calls reviewed via call-review in window
- Pattern: discovery depth strong (avg 7/10 on call-review scale); talk-to-listen
  ratio improving; weak on economic buyer access -- champion not probed in 3 of 4 calls

FOCUS AREA 1: Economic buyer access on BetaCo
  Evidence: BetaCo MEDDPICC E = red; last EB contact 45 days ago; deal-review risk flag
  Coaching question: "What's your read on why the CFO has gone quiet, and what
    options do you see to re-engage without going around Marcus?"
  Suggested next action: [Sarah] to draft a business-case email to CFO; manager
    reviews -- by 2026-06-21

FOCUS AREA 2: Meeting booking cadence
  Evidence: 7/10 meetings booked vs. target (rules/targets.md); email-heavy cadence
    vs. calls flagged by activity-audit
  Coaching question: "When you look at where those 3 meetings didn't happen, what
    got in the way of the call?"
  Suggested next action: [Sarah + manager] agree on a 2-week calling block trial;
    review together at next 1:1 -- 2026-07-03

SESSION CLOSE: Book the follow-up 1:1 before ending this call (meeting-standards).
```

**Rep with no recent call-review data:**

```text
manager: "coaching prep for Tom -- he's new, 60 days in"

Note: Tom is in ramp month 2 (60-day ramp month). Quota is ramped per
rules/targets.md; compare activity to ramped targets, not full-quota targets.
No call-review outputs exist yet for Tom this quarter -- flag this.

COACHING BRIEF: Tom Nguyen -- 2026-06-19
Ramp month 2 of 3 (rules/targets.md ramp schedule)

STRENGTHS
- 3 new opportunities created in ramp month 2 -- on pace for ramp target

CALL QUALITY SNAPSHOT
- No call-review outputs for Tom this quarter yet.
  Suggested action: schedule a call-review session with Tom this week to
  establish a baseline and identify early coaching patterns.

[remainder of brief follows standard structure with ramped targets]
```

## Anti-patterns

- **Using activity targets to score or rank the rep as a person.** Numbers are
  coaching inputs per `rules/targets.md`. "Your call volume is 60% of target"
  opens a coaching question; "you are a low performer" is not what this skill
  produces. Frame accordingly.
- **Fabricating a strength.** If the data does not support a genuine
  strength, do not invent one. Anchor on what IS working even if the bar is
  low ("logging is consistent, even if volume is below target").
- **Listing more than two focus areas.** A manager who tries to address
  seven things in a 30-minute 1:1 will address none of them. Choose the two
  highest-leverage items; park the rest.
- **Re-scoring MEDDPICC.** The `deal-review` skill owns red/amber/green.
  This skill consumes that output and references the gaps -- it does not
  introduce a new scoring scale or override the deal-review rubric.
- **Re-scoring call quality with a MEDDPICC or ICP scale.** Call scores come
  from `call-review`, which defines its own explicit scale. Reference that
  output; do not re-label call quality as red/amber/green (that is MEDDPICC
  territory) or 0-100 (that is ICP territory).
- **Skipping the session-close step.** Per `rules/common/meeting-standards.md`,
  every coaching session ends with an agreed, dated next step. Flag this in
  the brief so the manager remembers to close it.
- **Claiming a CRM record was updated.** Coaching prep is read-only. Any
  update routes through `crm-operator` after the session, not during prep.

## Related

- `coaching-analyst` (agent, read-only, sonnet) -- builds the rep-level data
  brief this skill frames. Always dispatched in step 2.
- `deal-review` -- owns MEDDPICC red/amber/green; coaching-prep cites its
  output, does not re-derive the rubric.
- `activity-audit` -- owns cadence and logging compliance scoring; coaching-prep
  cites its output.
- `call-review` -- owns call scores; coaching-prep references scored output
  without re-scoring.
- `stakeholder-mapping` -- committee depth on key deals surfaces as a
  pipeline-health input.
- `rules/targets.md` -- quota, ramp, and activity targets; the authoritative
  source for all numeric benchmarks used in the brief.
- `rules/common/meeting-standards.md` -- every coaching session ends with an
  agreed, dated next step.
- `crm-operator` (agent) -- sole writer; any deal updates resulting from a
  coaching conversation route here post-session.
- `/coach` command -- thin shim that delegates to this skill.
