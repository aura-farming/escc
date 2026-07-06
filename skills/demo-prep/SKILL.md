---
name: demo-prep
description: >-
  Demo storyline tied to discovered pain with stakeholder-specific moments and
  a readiness checklist. Trigger: 'prep the demo', 'demo plan for <account>',
  'what do I show the CFO'.
origin: ESCC
---

# Demo Prep

A demo without a story is a feature tour. Demo-prep turns the buyer's discovered
pain and their committee map into a **narrative arc** — an opening that names
their problem, capability moments that resolve it for each stakeholder in the
room, and proof points that make the resolution credible. Environment readiness
sits alongside the story so the demo does not break at the wrong moment.

> **Governing rule:** `rules/common/meeting-standards.md` — no customer
> meeting without prep. All capability claims and social proof come from
> `product-knowledge` (approved). The discovered pain (MEDDPICC I) and the
> stakeholder map come from `discovery-notes` and `stakeholder-mapping`
> respectively. Do not invent capability claims or fabricate customer evidence.

## When to Activate

Activate this skill when:

- A demo is scheduled and a rep needs a structured storyline, tailored moments,
  and a readiness check.
- "Prep the demo for [Account / persona]" or "build a demo plan" is the request.
- An SE or AE needs to adapt a standard demo flow to specific discovered pain.
- A custom proof-of-concept (POC) narrative needs to be built from the account's
  stated success criteria.
- The rep asks "what should I highlight for the CFO vs. the end user" or "how
  do I tie the demo to what they told me in discovery."

Do **not** activate for discovery calls (that is `call-prep`/`discovery-notes`)
or for proposal and business-case writing after the demo (those are
`proposal-builder` and `business-case`). This skill runs before the demo;
`discovery-notes` ran before this.

Segment depth scales per `rules/segments/{enterprise,mid-market,smb}.md`:
enterprise demos involve multi-role moment design and a formal POC success-
criteria block; SMB demos are a tight 20-minute value storyline.

## Workflow

### 1. Load the discovered pain and MEDDPICC context

- Retrieve the MEDDPICC I (Identify pain) field from `discovery-notes` — the
  structured capture from prior discovery calls. This is the buyer's stated,
  sourced pain; it is the anchor of the storyline.
- If MEDDPICC I is blank or weak (no quantified problem, no "compelling reason
  to act now"), flag it: a demo without a pain anchor is a feature tour and
  should be deferred until discovery produces one.
- Also retrieve: Metrics (M) if known (the quantified target to tie back to),
  Decision criteria (D) if known (the buyer's stated evaluation lens), and
  known Competition (C) (to know what you are being compared against and which
  differentiators matter).

### 2. Map the buying committee to demo moments

- Pull the current committee map from `stakeholder-mapping`: who is attending,
  their role (economic buyer / champion / end-user / technical evaluator /
  legal-procurement / executive sponsor), and what each role cares about.
- For each attendee, assign a **demo moment** — the specific capability or
  outcome in the demo that speaks to their pain or evaluation criterion:

  | Attendee | Role | Their primary concern | Demo moment to land |
  |----------|------|-----------------------|---------------------|
  | [Name]   | ...  | ...                   | ...                 |

- Economic buyer moments focus on ROI, risk reduction, and strategic fit.
- End-user moments focus on time saved, workflow improvement, and ease.
- Technical evaluator moments focus on integrations, security, and data model.
- Champion moments reinforce the narrative they are already selling internally.
- If a role is attending but no moment is mapped, that is a gap — add a default
  moment or note the oversight.

### 3. Build the demo storyline

Structure the demo as a three-act narrative:

**Act 1 — The Problem (2-3 minutes)**
- Open by naming the buyer's pain in their language, sourced from
  `discovery-notes`. Confirm it with the buyer: "We heard X — is that still
  the right framing?"
- Connect it to the business cost (use MEDDPICC M if known): "You said that
  is costing you Y — that is what we want to eliminate today."
- Do not open with product or company slides.

**Act 2 — The Resolution (bulk of demo)**
- Walk through the moments mapped in step 2, in a sequence that reflects the
  buyer's workflow — not the product navigation menu.
- For each moment, anchor to the pain ("this is where the reconciliation
  currently takes three days — here is what it looks like in our system").
- At each proof point, pull the approved claim from `product-knowledge`:
  - Metric claims must have a `proof-point` entry (approved, fresh).
  - Customer references must have a `proof-point` entry naming the customer
    and the outcome (approved, permission confirmed).
  - If no approved proof exists for a capability claim, state it as a
    product capability only — not as a customer outcome. Do not invent stats.
- Surface social proof ("a company similar to yours") only when a matching
  approved reference exists in `product-knowledge`. Do not substitute a
  plausible-sounding name.

**Act 3 — The Close (2-3 minutes)**
- Summarize what was shown against the stated pain and metrics.
- Ask the buyer what they saw that resonated and what questions remain.
- Transition to the next step (per `meeting-standards`, every open deal leaves
  with a dated next step): mutual-action-plan, POC kick-off, technical
  review, proposal, or follow-up.

### 4. Build the proof and social proof block

- List every proof point, metric, and customer reference the storyline uses,
  each with its `product-knowledge` entry ID, approval status, and guardrail.
- If the storyline calls for a proof point that does not exist in
  `product-knowledge`, mark it **[MISSING — do not state]** and soften the
  corresponding moment to a question or a stated capability.
- Confirm that all guardrails are respected (e.g. a security posture claim
  restricted to security-only audiences is not used in a RevOps demo).

  | Claim in storyline | pk-entry | Approved | Guardrail | Action |
  |--------------------|----------|----------|-----------|--------|
  | ...                | ...      | ...      | ...       | USE / SOFTEN |

### 5. Environment and readiness checklist

Before the demo runs, verify:

- [ ] Demo environment is seeded with data that mirrors the buyer's use case
  (not generic sandbox data that looks nothing like their workflow).
- [ ] Login credentials for the demo account are confirmed working.
- [ ] Any integrations that will be shown (CRM sync, SSO, API) are enabled and
  tested in the demo tenant.
- [ ] Screen share is tested; second monitor layout is set (notes visible,
  browser maximized).
- [ ] Notifications, Slack, and email are silenced on the demo machine.
- [ ] Backup plan if live demo fails: recording of the key flow, screenshots,
  or a narrated walkthrough in staging.
- [ ] Async demo link (if applicable) is recorded, reviewed, and trimmed before
  sending.
- [ ] Any co-presenter (SE, exec) has reviewed the storyline and knows their
  moments.

### 6. Flag risks before the demo

- **Pain not confirmed in discovery (MEDDPICC I is blank):** flag explicitly
  and recommend deferring the demo until a discovery call closes the gap.
- **Economic buyer absent from the demo:** note the gap; plan a champion
  debrief immediately after so the champion can re-run the story internally.
- **Proof point required but not in product-knowledge:** mark it
  [MISSING — soften]; do not demo a claim you cannot back.
- **Competitor named in evaluation (MEDDPICC C):** check approved
  differentiation in `product-knowledge`; surface relevant moments that address
  the competitor's claimed strengths without naming them disparagingly.

## Examples

**Full tailored demo storyline — mid-market RevOps buyer:**

```text
/demo-prep deal-id:DEAL-4421 GlobalRetail, demo with Jordan Kim + Dana Reeves

demo-prep output:
MEETING: 2026-06-20 14:00 — Product Demo / 60 min
ATTENDEES + MOMENTS:
  Jordan Kim, Sr. Director Finance [champion]
    Moment: month-end close reconciliation flow (their stated pain)
  Dana Reeves, CFO [economic buyer]
    Moment: forecast accuracy dashboard — executive view (ROI/risk framing)

DISCOVERED PAIN [discovery-notes, DEAL-4421, 2026-06-10]:
  I: "Month-end close reconciliation takes 3 days; forecast accuracy is ~60%;
      leadership is making headcount decisions on bad data." [Jordan, call 2]
  M: "Target: same-day close reconciliation; 85%+ forecast accuracy."

DEMO STORYLINE:
  Act 1 — Problem (3 min):
    "Jordan, when we last spoke you told us that reconciliation is a 3-day
    ordeal and your forecasts are running at about 60% accuracy. The risk
    is that Dana is making headcount decisions on numbers she cannot trust.
    That is what we want to show you today — what it looks like when that
    problem is gone. Does that still capture it?"

  Act 2 — Resolution:
    [08 min] End-user moment (Jordan): Live reconciliation flow —
      show a month-end close running in real time, single source of truth.
      Claim: "mid-market RevOps teams reach first forecast in 1 day"
      [pk-entry PP-031, approved 2026-05-02, guardrail: internal metric —
      attribute as 'in our onboarding data']. SAY: "teams like yours are
      forecasting on day one based on our onboarding data."
    [12 min] Economic buyer moment (Dana): Executive forecast dashboard —
      pipeline by stage, rep attainment, call recording summary.
      Social proof: [pk-entry PP-041, approved, Meridian Group, 93%
      forecast accuracy]. SAY: "a company at a similar growth stage saw
      their forecast accuracy go from 58% to 93% in their first quarter."
    [10 min] Decision-criteria moment: Integration demo — CRM sync
      live (HubSpot data flowing into the view they are seeing).

  Act 3 — Close (5 min):
    "You told us same-day close and 85% accuracy — did what you saw
    today give you confidence we can get there? What questions do you
    still have?" → next step: mutual-action-plan kick-off call with
    Jordan and IT lead, targeted 2026-06-24.

PROOF BLOCK:
  PP-031 | "day-one forecast" | APPROVED | guardrail: attribute as
    internal metric | USE (with attribution)
  PP-041 | "Meridian Group 93% accuracy" | APPROVED | no guardrail | USE

ENVIRONMENT CHECKLIST:
  [ ] Demo tenant seeded with a "GlobalRetail-style" multi-entity dataset
  [ ] HubSpot integration enabled and syncing in demo tenant
  [ ] CFO dashboard view enabled for exec seat
  [ ] Credentials tested 30 min before call
  [ ] Screen notifications silenced
  [ ] SE briefed on Dana's moment (Act 2, minute 12)

RISK FLAGS:
  - Dana (economic buyer) is attending — this is the first time. Jordan
    should intro; confirm Dana's primary concern at the top of Act 1.
  - No approved proof for "reduces churn" — if Jordan asks, soften to a
    question: "how are you measuring retention risk today?"
```

**Minimal async demo — SMB inbound, single user:**

```text
/demo-prep SMB inbound — Taylor at Brightfield, async video

demo-prep output:
STORYLINE (4-min async):
  Open: name Taylor's stated pain from the sign-up form ("I need a
    faster close process"). Confirm with a one-sentence framing screen.
  Resolution: 3 key flows relevant to a solo RevOps operator at SMB scale.
    Claim: use approved value-prop VP-012 (SMB: "close in hours, not days").
  Close: direct CTA — "book a 20-min live call to walk through your setup."

PROOF BLOCK: VP-012 | APPROVED | no guardrail | USE

ENVIRONMENT CHECKLIST:
  [ ] Recording tool ready, screen clean
  [ ] Demo account shows SMB-scale data (10-20 deals, not 5,000)
  [ ] Video trimmed to under 4 minutes, no dead air
```

## Anti-patterns

- **Opening with product or company slides.** The buyer does not care about
  the founding story in minute one. Open with their pain; confirm it; then show
  the resolution. `discovery-notes` gave you the pain — use it.
- **A demo with no pain anchor.** If MEDDPICC I is blank, the storyline has
  no foundation. A feature tour with no "this is the problem it solves" moment
  is a demo that does not advance a deal. Defer until discovery closes the gap.
- **Inventing proof points or customer references.** Claims that do not trace
  to an approved `product-knowledge` entry are fabrications. Mark missing
  proof as [MISSING — soften]; do not state a statistic you do not have.
- **One-size-fits-all talk track for a committee.** The CFO and the end-user
  are in the same room but they are not watching the same demo. If moments are
  not differentiated by role, the economic buyer disengages. Use the committee
  map from `stakeholder-mapping`.
- **Skipping the environment checklist.** A broken integration or mis-seeded
  demo tenant in front of the CFO is a deal-qualifier in the wrong direction.
  Run the checklist; do not assume the demo environment is fine.
- **Ending without a next step.** Per `meeting-standards`, every open deal
  leaves with a dated next step. If the demo talk track ends with "any
  questions?" and no close ask, the brief is incomplete.
- **Using a guardrailed claim in the wrong audience.** A security posture
  claim restricted to security reviewers is not dropped into a RevOps demo
  because it "sounds good." Honor every `product-knowledge` guardrail.

## Related

- `product-knowledge` — the only source of approved capability claims,
  metrics, and customer references. All proof in the demo storyline traces here.
- `stakeholder-mapping` — owns the buying-committee model; demo-prep reads
  roles and assigns moments per role from it.
- `discovery-notes` — the source of MEDDPICC I (discovered pain) and any
  stated success criteria that anchor the storyline.
- `call-prep` — the pre-meeting brief for non-demo calls; demo-prep extends
  the same structure with the storyline and readiness checklist.
- `rules/common/meeting-standards.md` — the prep/run/recap discipline; demo-
  prep is the "prep" leg for demo meetings.
- `rules/common/selling-principles.md` — §2 (never fabricate product claims)
  governs the entire proof block.
- `rules/meddpicc/qualification.md` — field definitions for I, M, D, C used
  in the storyline anchor and differentiation.
- `rules/segments/{enterprise,mid-market,smb}.md` — depth overrides for
  committee moment design and POC scope.
