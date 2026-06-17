# ESCC Glossary

The shared vocabulary for ESCC. Every term below has one canonical owner -- the
rule or skill where its definition is authoritative. When a definition and an
owner file disagree, the owner file wins; this glossary points to it rather than
restating policy.

> The `escc-guide` skill answers "what does X mean" from this file. If a term you
> need is missing, the owner file (cited beside each entry) is the source of
> truth -- add the term here pointing back to it; do not invent a second
> definition elsewhere.

A term defined in one place and only *cited* elsewhere keeps a single meaning
across all SDR, AE, Manager, and RevOps surfaces. That is the whole point of the
"canonical owner" pattern: skills reference a definition; they do not fork it.

## Qualification and deal health

### MEDDPICC

The eight-element deal-qualification rubric -- Metrics, Economic buyer, Decision
criteria, Decision process, Paper process, Identify pain, Champion, Competition.
Each element is scored red / amber / green with evidence; a deal's health is its
*weakest critical element*, not an average.
Owner: `skills/deal-review/SKILL.md` (governing rules under `rules/meddpicc/`).

### Economic buyer

The person with discretionary budget authority -- named, met, and engaged. A red
(unknown or unengaged) economic buyer gates the entire deal regardless of other
greens. The "E" in MEDDPICC.
Owner: `skills/deal-review/SKILL.md`.

### Champion (vs. coach)

An internal advocate with power who sells when the rep is not in the room. The
champion test: ask them to take a specific internal action (set up a meeting with
the economic buyer, circulate a business case). A coach informs; a champion acts.
Do not forecast on an untested champion. The "C1" in MEDDPICC.
Owner: `skills/deal-review/SKILL.md`.

### Stage-exit criteria

The conditions a deal must meet to advance out of a lifecycle stage. A deal may
not occupy a stage whose exit criteria are unmet, and its stage must be
consistent with its forecast category (a commit cannot sit in early discovery).
Stage advances are checked by `pre:crm-write-guard`.
Owner: `rules/lifecycle-stages.md` (see also `rules/common/forecasting-definitions.md`).

### Accept / reject / disqualify / recycle

Explicit, logged dispositions on a lead or deal. SAL accept/reject carries a
reason; a rejected lead returns to nurture. Disqualify requires a reason code;
recycle sets a re-engage date. **None of these is a delete.**
Owner: `rules/lifecycle-stages.md`.

## Lifecycle and lead stages

### MQL (Marketing-Qualified Lead)

A lead that fits ICP signals and has been marketing-qualified -- the entry point
above raw Subscriber/Lead, below SAL.
Owner: `rules/lifecycle-stages.md` (ICP signals: `skills/icp-profile/SKILL.md`).

### SAL (Sales-Accepted Lead)

A lead a rep has explicitly accepted as worth working (or rejected with a reason)
within the response SLA. The handshake between marketing and sales.
Owner: `rules/lifecycle-stages.md`.

### SQL (Sales-Qualified Lead)

A real, qualified opportunity -- the lead has become a Deal. The point at which
MEDDPICC qualification begins in earnest.
Owner: `rules/lifecycle-stages.md`.

### Disposition

The recorded outcome label applied to an interaction. ESCC has two distinct
disposition taxonomies -- do not conflate them:

- **Reply disposition** -- the outcome of an inbound email reply: interested /
  not-now / out-of-office / wrong-person / referral / objection / unsubscribe.
  Owner: `skills/reply-handling/SKILL.md`.
- **Call disposition** -- the outcome of a dial, logged to the HubSpot call log.
  Owner: `skills/cold-calling/SKILL.md`.

## Forecasting

The four forecast categories below are owned by
`rules/common/forecasting-definitions.md`. Use these exact names; do not
re-categorize silently to protect a number.

### Commit

The rep will personally stake their name on the deal closing this period:
identified economic buyer, confirmed budget and paper path, a mutual close plan,
and MEDDPICC gaps closed. High confidence.
Owner: `rules/common/forecasting-definitions.md`.

### Best case

Could realistically close this period if upside breaks right, but known risks
remain. Medium confidence.
Owner: `rules/common/forecasting-definitions.md`.

### Pipeline

Open and qualified for the period but not yet best-case -- material gaps remain.
Owner: `rules/common/forecasting-definitions.md`.

### Omitted / Closed

Not forecast for the period: too early, slipped out, or already closed won/lost.
Owner: `rules/common/forecasting-definitions.md`.

## Revenue and retention metrics

### ACV (Annual Contract Value)

The annualised value of a contract. Net ACV = list price x (1 - discount rate),
annualised -- the number that drives discount-approval routing. In ramp/multi-year
deals, approval uses the highest single-year net ACV.
Owner: `skills/quote-desk/SKILL.md` (approval bands: `rules/approval-matrix.md`).

### ARR (Annual Recurring Revenue)

The recurring portion of contracted revenue on an annualised basis -- the
portfolio-level analogue of ACV across the book of business. Retention metrics
(NRR/GRR) are expressed against the recurring revenue base.
Owner: `skills/retention-rollup/SKILL.md`.

### NRR (Net Revenue Retention)

Revenue retained from an existing cohort including expansion and contraction, net
of churn, over a period. Captures whether the installed base grows or shrinks on
its own.
Owner: `skills/retention-rollup/SKILL.md`.

### GRR (Gross Revenue Retention)

Revenue retained from an existing cohort *excluding* expansion -- it can never
exceed 100%. Isolates pure leakage (churn + contraction) from upsell.
Owner: `skills/retention-rollup/SKILL.md`.

### Churn (gross / net)

Lost recurring revenue or logos over a period. Gross churn counts only losses;
net churn nets expansion against those losses. Logo churn counts accounts lost;
revenue churn counts dollars lost.
Owner: `skills/retention-rollup/SKILL.md`.

## CRM hygiene and data

### Survivorship

The rule set that decides, when two CRM records represent the same real-world
entity, which record is retained and enriched (the survivor) and which is merged
in and archived (the loser). Paired with association-preservation so no deal or
contact link is orphaned by a merge. No record is deleted as a byproduct.
Owner: `skills/dedupe-merge/SKILL.md`.

### Suppression list

The global do-not-contact registry. A contact on it -- via prior opt-out, DNC,
hard bounce, spam complaint, or legal hold -- is never contacted and never
re-added to a sequence. Suppression is global across personas and sequences, and
suppression always wins over any lawful basis.
Owner: `rules/common/outbound-compliance.md` (basis precedence: `rules/lawful-basis.md`).

### DNC / opt-out

A contact's request not to be contacted (Do Not Contact / unsubscribe), in any
channel or language. Detected by `inbox-triage` (class `opt_out_request`) or
`reply-handling` (disposition `unsubscribe`), then suppressed, recorded with
provenance, and confirmed honored within the jurisdiction deadline.
Owner: `skills/opt-out-handling/SKILL.md` (deadlines: `rules/common/outbound-compliance.md`).

## Routing, approval, and scoring

### Approval tiers

The escalation ladder for non-standard deal terms, keyed by discount percentage
and ACV band: rep self-serve -> Sales Manager -> Sales Manager + RevOps ->
VP Sales -> CRO + Finance. Approvals are gated at the hook boundary and
audit-logged, not granted on trust.
Owner: `rules/approval-matrix.md`.

> These approval Tiers are distinct from the `inbox-triage` message-classification
> labels and from ICP Tier A/B/C (`skills/icp-profile/SKILL.md`). Same word,
> different axes -- do not conflate.

### Bridge-score

A numeric ranking, B(m), of every potential warm-introduction path from the rep
(or team) to a target contact. It sums per-touchpoint base weights with per-hop
decay (lambda = 0.5), a second-order intro-friction multiplier (alpha = 0.3), and
an engagement lift (beta = 0.2). Higher score = warmer path. Tiers: Tier 1
(B >= 0.7, strong direct), Tier 2 (0.3 <= B < 0.7, second-degree/engaged), Tier 3
(B < 0.3, cold-but-relevant).
Owner: `skills/prospecting-pipeline/SKILL.md` (computed by the `warm-path-mapper` agent).

### 5-tier inbox classification

The fixed-priority labels `inbox-triage` assigns to every incoming message before
any reply or action. Applied in strict priority order, stopping at the first
match: `skip` (1) -> `info_only` (2) -> `meeting_info` (3) -> `deal_action` (4)
-> `action_required` (5), with `opt_out_request` as the overriding opt-out class.
A message that is both `deal_action` and `opt_out_request` is routed as an
opt-out -- no deal context overrides a suppression request.
Owner: `skills/inbox-triage/SKILL.md`.

## Related references

- Compliance floor and jurisdictions: `the-compliance-guide.md`,
  `rules/common/outbound-compliance.md`, `rules/jurisdictions/`.
- Data handling, provenance, and erasure: `rules/common/data-handling.md`,
  `rules/lawful-basis.md`, `docs/INCIDENT-RESPONSE.md`.
- Targets and capacity vocabulary (quota, coverage, ramp): `rules/targets.md`.
