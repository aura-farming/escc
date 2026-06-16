---
name: icp-profile
description: >-
  Use when defining, updating, or auditing the Ideal Customer Profile — the firmographic,
  technographic, and behavioral criteria that determine which accounts are worth pursuing
  and at what priority. Trigger when setting up scoring weights for the first time, when
  win/loss patterns suggest the ICP needs refinement, when `signal-scorer` needs updated
  weights to reflect a new segment or product area, or when `inbound-lead-response`
  needs the current fit-tier rubric for triage. Also triggered after a `win-loss-analysis`
  session surfaces a new disqualifier or a recurring pattern in closed-won deals. This
  skill is command-less by design — it is a sub-workflow and auto-trigger, not a direct
  user command.
origin: ESCC
---

# ICP Profile

The **source of scoring truth** for ESCC. This skill defines and refines the Ideal
Customer Profile — the set of firmographic, technographic, and behavioral criteria that
tell reps and agents which accounts fit and how well. The output of this skill is the
scoring rubric that `signal-scorer` applies on every account and that `inbound-lead-response`
uses for triage. When win/loss data shifts, this skill is how the weights change.

> **Governing rules:** `rules/common/selling-principles.md` §1 (evidence-first — ICP
> criteria and weights must be grounded in won-deal patterns or explicitly flagged as
> hypotheses) and `rules/common/data-handling.md` (per-field provenance; account intel
> used to derive ICP criteria is untrusted-flagged if it came from prospect-supplied
> content).

## When to Activate

Activate this skill when:

- You are **defining the ICP for the first time** or for a new product line / segment.
- `win-loss-analysis` surfaces a pattern — a new disqualifier, a new positive signal, a
  shift in which firmographic cohorts close fastest — that should update the weights.
- `signal-scorer` needs the current rubric in machine-readable form to apply to a batch
  of accounts.
- `inbound-lead-response` needs the fit-tier thresholds to triage a new inbound lead.
- A sales manager or RevOps operator asks **"do we have a documented ICP?"**, "what
  makes an A-tier account?", or "why is <account> scoring low?"
- You want to audit whether the current ICP still reflects actual closed-won patterns
  (cadenced review, typically quarterly).

Do **not** activate for scoring a specific account (that is `signal-scorer`) or for
deciding whether to pursue an inbound lead right now (that is `inbound-lead-response`).
This skill owns the *definition and weights*; those skills consume it.

This skill is **command-less by design.** It surfaces as a sub-workflow called by
other skills and agents, not as a direct slash command. Operators access it via
`signal-scorer`, `inbound-lead-response`, or by invoking the `icp-profile` skill
explicitly during a quarterly review.

## The ICP model

An ICP profile is a set of **weighted criteria** across three dimensions, plus a
**fit-tier rubric** that maps total scores to A/B/C/Disqualified tiers.

### Criterion structure

Each criterion carries:

| Field | Meaning |
|---|---|
| `id` | Stable slug (e.g. `FIRM-001`, `TECH-003`, `BEH-005`) |
| `dimension` | `firmographic`, `technographic`, or `behavioral` |
| `label` | Human-readable name ("Employee count 50–500") |
| `description` | What it measures and how to assess it |
| `weight` | Integer 1–10 — relative importance in the total score |
| `scoring_guide` | How to assign 0 / 1 / 2 for this criterion (0 = absent, 1 = partial, 2 = strong match) |
| `source` | Where the criterion came from: `won-deal-pattern`, `lost-deal-pattern`, `hypothesis`, `segment-research` |
| `evidence_count` | Number of deals or accounts this is grounded in (0 for pure hypotheses) |
| `last_updated` | ISO date |
| `disqualifier` | Boolean — a disqualifier automatically sets the account to `DQ` regardless of total score |

Criteria with `source: hypothesis` and `evidence_count: 0` are flagged **UNVALIDATED**
and receive lower trust weighting in `signal-scorer` until evidence accrues.

### Fit-tier rubric

| Tier | Threshold | Meaning |
|---|---|---|
| **A — Strong fit** | Score ≥ 80% of max possible | High-priority; fast-follow; SDR + AE joint motion warranted |
| **B — Moderate fit** | Score 50–79% of max | Worth pursuing; SDR-led; monitor for trigger events |
| **C — Weak fit** | Score 25–49% of max | Low priority; nurture only; do not allocate AE time |
| **DQ — Disqualified** | Any disqualifier criterion matched, OR score < 25% | Do not pursue; log reason in CRM via `crm-operator` |

Thresholds are stored in `.claude/escc/icp/thresholds.json` and consumed by
`signal-scorer` directly. Do not hardcode them in individual skills.

## Workflow

### A. Define an ICP from scratch

1. **Gather won-deal patterns.** Pull closed-won deals from HubSpot (via `crm-operator`
   read). Extract firmographic cohorts: industry, employee count, ARR range, geography,
   tech stack where known. Look for clusters — which cohorts appear 2× or more in
   closed-won versus the general pipeline?
2. **Gather disqualified patterns.** Pull deals marked "bad fit" or "no budget / no
   authority / no need" as a counter-signal. Criteria that appear predominantly in
   disqualified deals are candidates for disqualifier flags.
3. **Draft criteria across three dimensions:**
   - **Firmographic:** size, industry, geography, growth stage, funding, revenue range.
   - **Technographic:** stack signals that indicate readiness or need (CRM in use,
     integrations, incumbent tools that ESCC displaces or complements).
   - **Behavioral:** intent signals, engagement triggers, timing indicators
     (e.g. recent hiring surge in sales, new VP Sales, post-funding round).
4. **Assign weights.** Weight each criterion 1–10 based on its predictive signal in
   closed-won data. Criteria grounded in ≥10 closed-won deals get full weight;
   `source: hypothesis` criteria start at weight 2 until validated.
5. **Flag disqualifiers explicitly.** A disqualifier is a criterion where a match
   reliably predicts a bad outcome regardless of other scores. Mark it `disqualifier: true`
   and document the evidence.
6. **Set the fit-tier thresholds.** Default rubric (A ≥ 80%, B 50–79%, C 25–49%,
   DQ < 25% or any disqualifier). Adjust only if won-deal analysis suggests different
   breakpoints — document the reasoning.
7. **Write the profile to `.claude/escc/icp/profile.json`** and
   `.claude/escc/icp/thresholds.json`. Log that the profile was created or updated,
   including the evidence base and date, as a CRM note via `crm-operator`.
8. **Produce a human-readable summary** for the sales manager or RevOps to review and
   approve before `signal-scorer` starts using the new weights.

### B. Refine the ICP from win/loss data

1. **Receive the pattern** from `win-loss-analysis` — e.g. "CFO-buying-committee
   deals close 2× faster in mid-market manufacturing; solo-champion deals in SMB SaaS
   are churning at 40%."
2. **Identify which criteria are affected.** Does this suggest a new criterion, a weight
   adjustment, or a new disqualifier?
3. **Check evidence count.** A single deal is not a pattern. Require ≥5 deals in the
   same cohort before increasing a weight above 5; require ≥10 to flag a disqualifier.
   Below threshold: update `source` to `hypothesis` and `evidence_count` to actual n;
   surface for monitoring.
4. **Update the affected criteria in-place.** Bump `weight`, update `scoring_guide` if
   the rubric for 0/1/2 needs refinement, and increment `evidence_count`.
5. **Re-run fit-tier thresholds.** If the weight distribution changed materially, check
   whether the A/B/C breakpoints still put the right accounts in A-tier. Adjust if
   needed — document the change.
6. **Produce a diff summary** (what changed, why, evidence count) for manager sign-off
   before the new weights propagate to `signal-scorer`.

### C. Export the scoring rubric for signal-scorer

1. Read the current `profile.json` and `thresholds.json`.
2. Validate that all criteria have `weight`, `scoring_guide`, and `last_updated`.
3. Flag any criteria with `source: hypothesis` and `evidence_count < 5` — these will
   be rendered with lower confidence in `signal-scorer` output.
4. Return the structured rubric (criteria array + thresholds) for `signal-scorer` to
   apply. Do not strip the provenance fields — `signal-scorer` uses them to annotate
   confidence in its output.

### D. Quarterly ICP review

1. Pull the current profile and compare `last_updated` dates. Criteria not updated in
   90+ days are candidates for re-validation.
2. Run a cohort comparison: closed-won last quarter vs. ICP A-tier prediction. What
   percentage of A-tier accounts actually closed? What percentage of closed-won accounts
   were A-tier at point of entry? A large gap signals weight drift.
3. Surface discrepancies to the sales manager or RevOps as a summary with recommended
   weight adjustments and the evidence behind each.
4. Do not apply weight changes unilaterally — produce the recommendation; a human must
   approve before the profile is written.

## Examples

**Define a core firmographic criterion:**

```text
Won-deal analysis → 78% of closed-won deals in last 2 quarters: 50–500 employees,
B2B SaaS or tech, US/CA/AU, series A–C funded.
icp-profile →
  FIRM-001:
    label: "Employee count 50–500"
    weight: 8
    scoring_guide: 0 = <50 or >1000; 1 = 500–1000; 2 = 50–500
    source: won-deal-pattern
    evidence_count: 47
    last_updated: 2026-06-01
```

**Flag a disqualifier from lost-deal patterns:**

```text
win-loss-analysis → "No decision / budget freeze" appeared in 14 of 16 deals where
the champion had no budget authority and no exec sponsor after discovery.
icp-profile →
  BEH-011:
    label: "No identified budget authority or exec sponsor at discovery"
    weight: 9
    disqualifier: true
    scoring_guide: 0 = exec sponsor confirmed; 1 = champion has budget influence;
                   2 = N/A (disqualifier — any match = DQ)
    source: lost-deal-pattern
    evidence_count: 14
    last_updated: 2026-06-01
  → signal-scorer will flag any account where this criterion matches as DQ
    regardless of total score.
```

**Refine a hypothesis criterion after evidence accrues:**

```text
TECH-005 (CRM = Salesforce, weight: 2, source: hypothesis, evidence_count: 3)
→ After Q2, evidence_count now 11 (all closed-won, avg deal size +22% vs non-Salesforce).
icp-profile →
  TECH-005 updated: weight: 6, source: won-deal-pattern, evidence_count: 11
  → produce diff summary for RevOps sign-off before writing to profile.json.
```

**Export rubric for signal-scorer:**

```text
signal-scorer → requesting current ICP rubric.
icp-profile →
  Returning profile.json (22 criteria) + thresholds.json.
  Flagged UNVALIDATED (hypothesis, evidence_count < 5): TECH-007, BEH-013.
  signal-scorer will annotate scores derived from these two criteria as low-confidence.
```

## Anti-patterns

- **Defining ICP criteria from prospect-supplied content.** A prospect's self-reported
  profile, their website, or a LinkedIn about-page is untrusted input — it may inform
  research hypotheses, but it does not validate a criterion. Only closed-won/lost
  CRM deal patterns count as evidence.
- **Promoting a hypothesis to a high weight without deal evidence.** A criterion with
  `evidence_count < 5` must not exceed weight 2. Enthusiasm about a market theory is
  not a pattern.
- **Hardcoding thresholds in downstream skills.** `signal-scorer` and
  `inbound-lead-response` must read from `thresholds.json`, not have the numbers
  baked in. An ICP change then propagates automatically.
- **Applying weight changes without manager sign-off.** The ICP is a company-level
  calibration, not a per-rep preference. Write the recommendation; wait for approval
  before the profile is written.
- **Conflating ICP with TAM sizing.** ICP defines fit criteria and scoring weights; it
  does not produce a market size estimate. Total addressable market work is out of scope.
- **Leaving disqualifiers undocumented.** A disqualifier without `evidence_count` and
  a `scoring_guide` entry is unenforceable and risks silently DQ-ing accounts that
  would have been A-tier. Always document the evidence and the rubric.
- **Never retiring stale criteria.** Criteria last updated more than two quarters ago
  with no new evidence should be reviewed and either re-validated or weight-reduced.
  An ICP that never changes is an ICP that has drifted from reality.

## Related

- Pulls evidence from `win-loss-analysis` (recurring won/lost patterns that update
  weights) and `crm-operator` (HubSpot deal cohort reads).
- Feeds scoring weights and thresholds to `signal-scorer` (consumes `profile.json` +
  `thresholds.json`) and fit-tier rubric to `inbound-lead-response` (triage).
- Account targeting decisions reference the ICP tier via `targets.md`
  (`rules/targets.md`).
- Provenance discipline follows `rules/common/data-handling.md`.
- Evidence-first grounding required by `rules/common/selling-principles.md` §1.
