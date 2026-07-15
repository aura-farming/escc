---
name: mutual-action-plan
description: >-
  Owns the MAP — the shared buyer+seller milestone plan to signature. Trigger:
  'mutual action plan', 'build a MAP', 'joint milestones'. Seller-internal
  plan = close-plan; legal artifacts = paper-process.
origin: ESCC
---

# Mutual Action Plan

The **MAP** is the shared, buyer-and-seller milestone plan for a deal: both sides can see
it, both sides own tasks on it, and both sides agree its milestones reflect the real path
to a decision. It is the buyer-facing surface of a deal's forward motion.

> **Boundary:** `mutual-action-plan` OWNS the MAP document -- its structure, milestones,
> and joint-owner assignments. `close-plan` is a different skill: the seller's internal
> backward date-plan from target close to today. `paper-process` is a different skill:
> legal/procurement document tracking. This skill references both but does not re-implement
> them; their milestones feed the MAP, not the other way around.

> **Governing rules:** `rules/common/meeting-standards.md` (next steps on every open deal),
> `rules/meddpicc/deal-review.md` (decision-process evidence gates milestone validity),
> `rules/lifecycle-stages.md` (stage entry/exit criteria). A MAP milestone that has no
> decision-process evidence behind it is a placeholder, not a commitment.

## When to Activate

Activate this skill when:

- A deal enters **Validation/Proof** stage and no shared plan exists yet -- this is the
  trigger to build the initial MAP.
- The rep needs to **draft, share, or present** a MAP to a champion or economic buyer.
- An existing MAP needs to be **updated**: a milestone slipped, a new stakeholder was
  added, paper-process steps were confirmed, or the close date moved.
- A **deal review** (`deal-review`) flags "close date with no mutual plan" as a risk
  and you need to remediate it.
- The buyer asks "what does our path to decision look like?" -- the MAP is the answer.
- A **stage advance** is being assessed and you need to confirm the MAP reflects current
  reality before moving forward.

Do **not** activate to manage the seller's internal countdown (that is `close-plan`) or to
track redlines, approvals, and signature status on legal documents (that is `paper-process`).
The MAP cites those workstreams; it does not duplicate them.

## The MAP document structure

A MAP lives in `.claude/escc/deals/<account-slug>/map.md` (workspace-local). It has five
structural layers:

| Layer | Holds |
|---|---|
| **Header** | Account, deal stage, target close date, seller owner, buyer champion/EB |
| **Milestones** | The numbered, dated joint steps (see below) |
| **Owners** | Each milestone carries a seller owner AND a buyer owner |
| **Dependencies** | What each milestone needs before it can start |
| **Status** | Red / amber / green + a last-updated date per milestone |

### Milestone anatomy

Every milestone in the MAP is one record with these fields:

- `id` -- sequential integer
- `milestone` -- a short, action-oriented label ("Security review complete", "Champion
  presents to EB", "MSA redlines returned")
- `seller_owner` -- name or role (e.g. "AE", "Solutions Engineer")
- `buyer_owner` -- name or role on the buyer side (e.g. "IT Security Lead", "VP Ops")
- `target_date` -- an explicit calendar date, not "TBD" or "end of Q"
- `depends_on` -- ids of prerequisite milestones (empty if none)
- `status` -- red / amber / green
- `evidence` -- the decision-process fact or document that backs this milestone's
  reality (a meeting note, an email confirmation, a paper-process record from
  `paper-process`)

A milestone with no `buyer_owner` and no `evidence` is an amber placeholder -- flag it.

## Workflow

### A. Build a new MAP

1. **Read decision-process evidence.** Pull the deal's D (Decision process) and D (Decision
   criteria) from MEDDPICC via `deal-review`. These supply the buyer's real steps and
   approvals -- every MAP milestone must trace to at least one of them, or be a seller-owned
   logistics step. If the Decision process is blank or red, note it: the MAP will have
   placeholder milestones that need buyer confirmation.

2. **Identify the paper-process path.** From the `paper-process` skill's known state for this
   deal, extract the legal/procurement steps (security review, legal review, DPA, MSA,
   order form signature). These become MAP milestones with buyer owners drawn from the
   buying committee (`stakeholder-mapping`).

3. **Pull the stakeholder map.** From `stakeholder-mapping`, identify the buying-committee
   roles (champion, economic buyer, technical evaluator, procurement). Assign each relevant
   MAP milestone a buyer owner from this map. Do not invent buyer owners -- use only names or
   roles confirmed in the committee map or in a tool-result (call note, email, CRM record).

4. **Draft the milestone list.** Layer them chronologically:
   - Validation milestones (success criteria met, POC outcomes)
   - Technical approval milestones (security, IT, architecture)
   - Business case / EB presentation milestone
   - Paper-process milestones (MSA, DPA, order form)
   - Signature / close milestone
   Assign a target date to every milestone. If a date cannot be confirmed from
   decision-process evidence, mark it `[PLACEHOLDER -- needs buyer confirmation]` and flag
   it amber.

5. **Write the MAP file** to `.claude/escc/deals/<account-slug>/map.md` using the structure
   above. Reference the close-plan's target close date in the header but do not duplicate
   the close-plan's internal backward logic here.

6. **Surface gaps.** At the end of the draft, list any milestones still amber/red with the
   specific question to ask the buyer to confirm them. These become agenda items for the
   next meeting (`meeting-standards`: next step on every open deal).

### B. Update an existing MAP

1. **Read the current MAP** from `.claude/escc/deals/<account-slug>/map.md`.
2. **Identify what changed**: a milestone completed, a date slipped, a new stakeholder
   entered, or paper-process confirmed a new step.
3. **Update status fields** (red/amber/green) and dates for affected milestones. Never delete
   a slipped milestone -- change its status to amber and add a `slipped_reason` note.
4. **Check for cascades**: if a milestone slipped, advance the `target_date` on all milestones
   that depend on it.
5. **Re-check the close date**: if cascading slippage pushes milestones past the header close
   date, flag it explicitly -- the rep needs to either reset the close date or compress the
   plan with buyer agreement.
6. **Write the updated MAP file** and note what changed in the file header as `last_updated`.

### C. Share the MAP with the buyer

1. **Confirm the MAP reflects real buyer-confirmed milestones** before sharing -- any amber
   placeholder that has not been discussed with the buyer should be resolved first or
   labelled as a proposal pending their confirmation.
2. **Strip internal seller notes** (close-plan reasoning, internal pipeline notes) from the
   version you share; the buyer sees milestones, owners, and dates -- not your internal
   confidence scoring.
3. **The shared version is a draft** -- the rep sends it; the MAP is confirmed when the buyer
   acknowledges it (email, meeting note). Until then it is PROPOSED. Log the shared event
   in HubSpot via `crm-operator` (do not claim logged unless a tool-result confirms it).

## Examples

**Build a new MAP from MEDDPICC evidence:**

```text
Deal: Sample Co Corp · Stage: Validation · Target close: 2026-09-30
Decision process (from deal-review): EB signs off after IT security review + legal MSA.
Paper-process (from paper-process): MSA draft in progress; DPA needed; security review
  not yet scheduled.
Committee (from stakeholder-mapping): Champion = Dana W. (VP Ops), EB = CFO (unmet),
  IT Security Lead = Raj K., Procurement = TBD.

mutual-action-plan builds:
  #1  POC success criteria review  |  AE + SE  |  Dana W.  |  2026-07-15  |  green
        evidence: agreed criteria in call note 2026-06-20
  #2  IT security review            |  SE        |  Raj K.   |  2026-08-01  |  amber
        evidence: security questionnaire sent; review date [PLACEHOLDER]
  #3  Business case to EB           |  AE        |  Dana W.  |  2026-08-15  |  amber
        depends_on: #1, #2
        evidence: EB not yet met; milestone is a proposal pending champion confirmation
  #4  MSA redlines returned         |  Legal     |  Procurement TBD  |  2026-09-01  |  amber
        evidence: MSA draft in progress (paper-process); buyer procurement TBD
  #5  DPA signed                    |  Legal     |  Legal TBD  |  2026-09-10  |  red
        evidence: DPA not started; buyer legal contact unknown
  #6  Order form signed             |  AE        |  CFO      |  2026-09-30  |  red
        depends_on: #3, #4, #5

GAPS TO RESOLVE (agenda items for next meeting):
  - #2: Confirm security review date with Raj K.
  - #3: Book EB intro with Dana W. as sponsor.
  - #4/#5: Identify procurement and legal contacts; start DPA.
```

**Update a MAP after a milestone slip:**

```text
Milestone #2 (IT security review) slipped from 2026-08-01 to 2026-08-20 (Raj K. out of office).
mutual-action-plan:
  - Sets #2 status → amber, adds slipped_reason: "Raj K. OOO; rescheduled to 2026-08-20"
  - Cascades: #3 target_date advances to 2026-09-05, #6 target_date advances to 2026-10-15
  - Flags: close date in header (2026-09-30) is now inside #5 milestone; close date must
    move or buyer must compress paper-process. Rep must align with buyer.
  last_updated: 2026-07-10 · changed: #2 slip + #3/#6 cascade + close date conflict flag
```

**Share the MAP with the buyer:**

```text
Preparing buyer-facing version:
  - Remove internal notes (close-plan confidence scores, internal stage reasoning).
  - Flag #3 as "Proposed -- pending your confirmation of EB meeting date."
  - Flag #4, #5 as "Proposed -- please introduce your procurement and legal contacts."
  - Output: PROPOSED MAP (buyer version) · Sample Co Corp · 2026-07-10
  Status: PROPOSED. Confirmed when Dana W. acknowledges (email or meeting note).
  (Do not log as confirmed until tool-result proves acknowledgement.)
```

## Anti-patterns

- **A MAP with only seller-owned milestones.** If every milestone has a seller owner and
  no buyer owner, it is a seller to-do list, not a mutual plan. A real MAP has named buyer
  owners on the steps that require buyer action -- legal, security, EB sign-off.
- **Dates without decision-process evidence.** "MSA signed by Sep 30" with no evidence that
  the buyer's procurement team knows about this date is a wish, not a commitment. Label it
  amber/placeholder until the buyer confirms.
- **Claiming the MAP was shared or confirmed without a tool-result.** A draft produced here
  is a draft. Shared = the rep sent it. Confirmed = the buyer acknowledged. Neither is
  asserted without proof.
- **Embedding close-plan backward logic into the MAP.** The close-plan is the seller's
  internal countdown; it informs the MAP's target dates but does not belong in the
  buyer-facing document. Keep the two artifacts separate.
- **Treating the MAP as static.** A MAP that hasn't been updated since the last milestone
  changed is stale. Update it whenever a milestone completes, slips, or a new stakeholder
  enters the deal.
- **Inventing buyer owners.** If you do not know who owns a step on the buyer side, use the
  role label (e.g. "Buyer Legal TBD") and flag it red -- do not invent a name or assume
  the champion owns everything.
- **Using a TBD close date.** The MAP header must carry a real date or explicitly flag the
  close date as unconfirmed. A MAP with "TBD" close date cannot be used for deal review.

## Related

- `close-plan` -- the seller's internal backward date-plan; its target close date feeds the
  MAP header; this skill does not redefine it.
- `paper-process` -- legal/procurement document tracking; its steps feed MAP milestones;
  this skill does not re-implement it.
- `deal-review` (`rules/meddpicc/deal-review.md`) -- Decision process evidence is the
  MAP's validity source; a red D (Decision process) means MAP milestones are placeholders.
- `stakeholder-mapping` -- the buying-committee map; buyer owners on MAP milestones come
  from it.
- `rules/common/meeting-standards.md` -- every open deal needs a next step; MAP gap items
  become agenda items.
- `rules/lifecycle-stages.md` -- stage entry criteria gate when a MAP is required.
