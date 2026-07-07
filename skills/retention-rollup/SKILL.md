---
name: retention-rollup
description: >-
  Portfolio revenue-retention analysis — NRR, GRR, churn, at-risk renewals,
  expansion rate. Trigger: 'NRR', 'churn rate', 'renewal portfolio', 'logo
  retention'. Single account = renewal-playbook.
origin: ESCC
---

# Retention Rollup

Portfolio-level NRR, GRR, churn, and at-risk renewal analysis across the
AE-owned renewal and expansion book. This skill OWNS the NRR/GRR/churn
definitions -- other skills cite these definitions and point here.

> **Canonical owner:** this skill defines Net Revenue Retention (NRR), Gross
> Revenue Retention (GRR), gross churn, net churn, and expansion rate. All
> other skills that reference these metrics cite retention-rollup and use these
> exact definitions.
>
> **Governing rules and related skills:**
> `rules/common/forecasting-definitions.md` -- forecast categories for renewal
> pipeline (Commit / Best case / Pipeline / Omitted/Closed). Use exact names.
> `renewal-playbook` -- the single-account renewal health-check skill.
> retention-rollup is the PORTFOLIO view (many accounts, aggregate metrics);
> renewal-playbook is the ACCOUNT view (one account, detailed health-check).
> These are distinct and complementary. Cross-reference; never merge.
>
> **Scope note (AE-owned):** retention here is the AE-owned renewal and
> expansion portfolio view. CS/post-sale tooling is an explicit product cut
> (Amendment A.1) -- this skill is NOT a CS tool. It reports the revenue
> health of the accounts the AE team owns and renews.
>
> **Execution:** the `pipeline-auditor` agent reads the renewal opportunities
> and contract records from HubSpot (read-only); `metrics-analyst` computes
> NRR/GRR/churn from that tool-result. It does NOT query HubSpot directly.
> Any CRM write (e.g., tagging an account as at-risk) routes through
> `crm-operator` only.

## When to Activate

Activate this skill when:

- A RevOps analyst, CRO, or Sales Manager wants a **portfolio NRR or GRR
  figure** for a period or cohort.
- A team needs to understand the **composition of churn** -- logo churn vs.
  revenue churn, gross vs. net.
- A leader wants to see the **at-risk renewal portfolio** -- which accounts
  have renewals due and what is the at-risk dollar exposure.
- The `/retention` command is invoked.

Do **not** use this skill to:
- Run a health check on a single account's renewal (that is `renewal-playbook`).
- Score individual deal MEDDPICC health (that is `deal-review`).
- Report new-business pipeline coverage (that is `sales-reporting` Mode 2).

---

## Metric Definitions (Canonical)

### Net Revenue Retention (NRR)

NRR measures how much of the starting-period ARR is retained and grown through
renewals, expansions, and upsells, after accounting for downgrades and churn.

```
NRR = (Starting ARR + Expansion ARR - Downgrade ARR - Churned ARR) /
      Starting ARR
```

- **Starting ARR:** the recurring revenue from the cohort at the start of the
  measurement period.
- **Expansion ARR:** additional ARR added from the same cohort during the
  period (upsell, cross-sell, seat expansion).
- **Downgrade ARR:** ARR lost from the cohort due to tier or seat reduction,
  without full churn.
- **Churned ARR:** ARR lost from the cohort due to contract cancellation or
  non-renewal.

NRR > 100%: the existing customer base is growing even without new logos.
NRR = 100%: all churn and downgrades are exactly offset by expansions.
NRR < 100%: the base is shrinking from the existing customer cohort.

### Gross Revenue Retention (GRR)

GRR measures how much starting ARR is retained after churn and downgrades,
without counting expansions. GRR is always <= 100%.

```
GRR = (Starting ARR - Downgrade ARR - Churned ARR) / Starting ARR
```

GRR isolates the "keep what we have" signal, independent of upsell
performance. Compare NRR and GRR together: a large NRR-GRR gap means the
business is masking churn with expansion -- expansion is hiding a retention
problem.

### Gross Churn Rate

```
Gross churn rate = Churned ARR / Starting ARR
```

The percentage of starting ARR lost to cancellations and non-renewals in the
period. Does not offset for expansion.

### Net Churn Rate

```
Net churn rate = (Churned ARR - Expansion ARR) / Starting ARR
```

Net churn rate can be negative (net negative churn) when expansion exceeds
gross churn. Negative net churn is a strong signal that the customer base is
self-sustaining.

### Logo Retention Rate

```
Logo retention = (Starting customers - Churned customers) /
                 Starting customers
```

Counts customers, not dollars. A high logo retention with low GRR signals
that small customers are being retained but large ones are churning (dollar-
weighted churn is more severe than logo churn implies).

### Expansion Rate

```
Expansion rate = Expansion ARR / Starting ARR
```

The fraction of starting ARR added back as expansion. NRR - GRR = expansion
rate contribution.

---

## Workflow

### Step 1: Define Cohort and Period

Confirm:
- Measurement period (trailing 12 months, quarter, or a defined cohort
  vintage -- e.g., accounts that started in Q1 2025).
- Scope: all accounts, a segment (enterprise / mid-market / SMB per
  `rules/segments/*`), or a named rep's book.
- ARR field mapping in HubSpot (confirm with RevOps if non-standard).

### Step 2: Pull ARR Components

The `pipeline-auditor` agent reads the renewal opportunities and contract
records from HubSpot (read-only); `metrics-analyst` computes NRR/GRR/churn
from that tool-result for the cohort:

- Starting ARR: sum of ARR for in-scope accounts at period start.
- Expansion ARR: sum of upsell / seat-expansion deal amounts closed during
  the period for the same cohort.
- Downgrade ARR: sum of ARR reductions from downgrades (tier or seat) during
  the period.
- Churned ARR: sum of ARR from accounts that cancelled or did not renew during
  the period.
- Churned logo count and total starting logo count (for logo retention).

### Step 3: Compute Metrics

Apply the definitions above. Compute:
1. NRR
2. GRR
3. Gross churn rate
4. Net churn rate
5. Logo retention rate
6. Expansion rate

Flag if NRR and GRR diverge materially (>10pp gap): this signals that
expansions are masking a churn problem.

### Step 4: Build the At-Risk Renewal Portfolio

Pull all renewal opportunities due in the forward period (next 30, 60, 90
days by default -- confirm horizon with the requestor).

For each renewal opportunity, the `pipeline-auditor` agent retrieves from
HubSpot; `metrics-analyst` analyzes the result:
- Account name, ACV, renewal date.
- Forecast category (Commit / Best case / Pipeline / Omitted/Closed per
  `rules/common/forecasting-definitions.md`).
- Last engagement date and open support/escalation flags (if available in
  HubSpot).
- Whether a renewal-playbook health-check has been run for this account
  (if yes, surface the health signal; if no, flag as unreviewed).

Segment the at-risk portfolio:
- **High risk:** renewal in <30 days, forecast category Pipeline or below,
  and/or no engagement in >30 days.
- **Medium risk:** renewal in 30-60 days, forecast category Best case, some
  engagement gaps.
- **Low risk:** renewal in 60-90 days, forecast category Commit, recent
  engagement.

Compute at-risk ARR exposure: total ACV of high-risk and medium-risk
renewals.

### Step 5: Return the Retention Summary

Return:
- Period and cohort scope.
- NRR, GRR, gross churn rate, net churn rate, logo retention rate,
  expansion rate -- each with the formula populated (not just the number).
- NRR vs. GRR gap analysis (if > 10pp, flag explicitly).
- At-risk renewal portfolio: table by risk tier, ARR exposure, renewal dates.
- Top 3-5 accounts by at-risk ACV with a one-line status each.
- Recommended action: accounts due for a renewal-playbook health-check
  (unreviewed high-risk renewals).

---

## Examples

**Portfolio NRR/GRR, trailing 12 months:**

```text
Request: "What is our NRR and GRR for the trailing 12 months, all segments?"

metrics-analyst rollup (from pipeline-auditor tool-result):

Cohort: All accounts | Period: Q3 2025 -- Q2 2026 (trailing 12 months)

ARR components:
  Starting ARR:   $8,200,000
  Expansion ARR:  $1,640,000
  Downgrade ARR:  $  180,000
  Churned ARR:    $  820,000

Metrics:
  NRR: ($8,200,000 + $1,640,000 - $180,000 - $820,000) / $8,200,000
     = $8,840,000 / $8,200,000 = 107.8%

  GRR: ($8,200,000 - $180,000 - $820,000) / $8,200,000
     = $7,200,000 / $8,200,000 = 87.8%

  Gross churn rate: $820,000 / $8,200,000 = 10.0%

  Net churn rate: ($820,000 - $1,640,000) / $8,200,000 = -10.0%
     (net negative churn -- expansion exceeds gross churn)

  Logo retention: 142 starting / 14 churned = 90.1%

  Expansion rate: $1,640,000 / $8,200,000 = 20.0%

NRR vs. GRR gap: 107.8% - 87.8% = 20.0pp
FLAG: Gap exceeds 10pp. Expansion is significantly offsetting churn.
  GRR at 87.8% means 12.2% of starting ARR was lost to churn/downgrades
  before expansion is counted. While NRR is healthy, the underlying
  churn rate warrants attention -- the expansion engine must remain strong
  to sustain NRR above 100%.

Gross churn rate 10.0% -- monitor by segment to identify if churn is
concentrated (run segment-level breakdown if needed).
```

**At-risk renewal portfolio, next 60 days:**

```text
Request: "Show me the at-risk renewal portfolio for the next 60 days."

metrics-analyst rollup (from pipeline-auditor tool-result, accounts due within 60 days):

Note: Health labels (Green / Amber / Red) here are the `renewal-playbook`
account-health scale -- not the MEDDPICC deal-scoring rubric.

Account          | ACV      | Renewal    | Forecast   | Last eng.  | Health
-----------------|----------|------------|------------|------------|-------
Example Co Corp        | $210,000 | 2026-07-05 | Pipeline   | 2026-05-12 | Unreviewed
BetaInc          | $ 88,000 | 2026-07-14 | Commit     | 2026-06-28 | Green (renewal-playbook run 2026-06-20)
GammaCorp        | $145,000 | 2026-07-22 | Best case  | 2026-06-01 | Unreviewed
DeltaSys         | $ 62,000 | 2026-08-03 | Best case  | 2026-06-15 | Amber (renewal-playbook run 2026-06-10)
EpsilonLtd       | $ 38,000 | 2026-08-18 | Commit     | 2026-06-25 | Green (renewal-playbook run 2026-06-18)

Risk segmentation:
  HIGH RISK (renewal <30 days, Pipeline or unreviewed):
    Example Co Corp: $210,000 -- renewal 2026-07-05, forecast Pipeline,
      last engaged 2026-05-12 (35 days ago), no renewal-playbook run.
      ACTION: run renewal-playbook health-check immediately; 19 days to
      renewal.

  MEDIUM RISK (30-60 days, Best case or engagement gaps):
    GammaCorp: $145,000 -- renewal 2026-07-22, forecast Best case,
      last engaged 2026-06-01 (15 days ago), no renewal-playbook run.
      ACTION: run renewal-playbook and re-engage within 5 days.
    DeltaSys: $62,000 -- renewal-playbook run; Amber health signal.
      ACTION: escalate to manager if health does not improve by 2026-07-10.

  LOW RISK (60+ days, Commit, recent engagement):
    BetaInc: $88,000 -- Commit, recent engagement, Green health.
    EpsilonLtd: $38,000 -- Commit, recent engagement, Green health.

At-risk ARR exposure (High + Medium): $210,000 + $145,000 + $62,000 = $417,000
```

**Segment-level NRR breakdown:**

```text
Request: "Break NRR down by segment."

Enterprise NRR: 112% -- expansion is strong; 2 churn events ($180k)
Mid-market NRR: 104% -- modest expansion; higher churn count (6 logos, $220k)
SMB NRR: 91% -- churn exceeds expansion; logo churn at 18% (GRR: 84%)

Insight: SMB is the primary churn risk. NRR below 100% means the SMB base is
shrinking without new logo additions. Mid-market expansion is absorbing the
drag at the portfolio level. Recommended action: review SMB at-risk portfolio
and confirm renewal-playbook is being run for all SMB accounts renewing in
the next 90 days.
```

---

## Boundary with renewal-playbook

`retention-rollup` and `renewal-playbook` are complementary; they do not
overlap.

| Dimension | retention-rollup | renewal-playbook |
|-----------|-----------------|-----------------|
| Scope | Portfolio (many accounts) | Single account |
| Output | NRR, GRR, churn, at-risk table | Account health score, renewal risk, action plan |
| When | Period review, board narrative, RevOps reporting | Before a renewal conversation, when an account is flagged at-risk |
| Who | RevOps, Sales Manager, CRO | AE assigned to the account |

When `retention-rollup` flags an unreviewed high-risk account, the recommended
action is to run `renewal-playbook` for that account. The two skills
hand off cleanly; they do not duplicate each other.

---

## Anti-patterns

- **Conflating NRR and GRR.** NRR includes expansion; GRR does not. Never use
  them interchangeably. When a stakeholder says "retention rate" without
  qualification, ask whether they mean NRR or GRR -- the two tell different
  stories.
- **Ignoring the NRR-GRR gap.** A gap > 10pp means expansion is masking
  churn. Surface this explicitly rather than leading with a strong NRR number
  without noting the underlying GRR.
- **Fabricating ARR components.** Every ARR figure must come from a
  `pipeline-auditor` HubSpot tool-result analyzed by `metrics-analyst`.
  Do not estimate or approximate starting ARR, churned ARR, or expansion
  ARR from memory or a verbal description.
- **Using gross churn count instead of gross churn rate.** "14 logos churned"
  is context-free. Always express churn as a rate (churned ARR / starting ARR
  or churned logos / starting logos) so it is comparable across periods.
- **Running retention-rollup as a CS tool.** This skill is the AE-owned
  renewal/expansion portfolio view. CS/post-sale workflows are out of scope
  (Amendment A.1). Do not frame this skill as tracking post-sale health,
  onboarding, or product adoption -- those are outside ESCC's product cut.
- **Merging retention-rollup and renewal-playbook into a single workflow.**
  They are distinct. retention-rollup surfaces the portfolio; renewal-playbook
  investigates one account. Route from rollup to playbook as a handoff, not
  as a merge.
- **Reporting NRR without stating the period and cohort.** NRR is meaningless
  without a defined measurement window and cohort. Always state both.

## Related

- Metric definitions cited by others: this skill owns NRR, GRR, gross churn,
  net churn, logo retention, expansion rate. Skills that use these terms cite
  retention-rollup.
- Single-account renewal health: `renewal-playbook` (DISTINCT; cross-reference;
  do not merge).
- Forecast categories: `rules/common/forecasting-definitions.md` (Commit /
  Best case / Pipeline / Omitted/Closed -- exact names for renewal pipeline).
- Segment context: `rules/segments/enterprise.md`,
  `rules/segments/mid-market.md`, `rules/segments/smb.md`.
- Period attainment and pipeline-coverage: `sales-reporting` (new-business
  metrics; separate from retention metrics).
- CRM reads: `pipeline-auditor` (reads renewal opportunities and contract
  records from HubSpot; read-only).
- Analytics: `metrics-analyst` (read-only; computes NRR/GRR/churn from the
  pipeline-auditor tool-result; does NOT query HubSpot directly).
- CRM writes: `crm-operator` (sole writer; at-risk tagging routes here).
- Command: `/retention`.
