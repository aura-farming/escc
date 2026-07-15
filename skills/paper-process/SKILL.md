---
name: paper-process
description: >-
  Per-artifact status log for legal/procurement docs — MSA, DPA, order form,
  security review. Trigger: 'where is the MSA', 'paper process status'. Maps
  to MEDDPICC P. Sequencing = close-plan.
origin: ESCC
---

# Paper Process

Per-artifact tracking of every legal and procurement document required to close a
deal: MSA, DPA, order form, security review questionnaire, and any ancillary
agreements. This is MEDDPICC element P — the paper process.

> **Governing rules:**
> - `rules/meddpicc/qualification.md` — P (paper process) is a MEDDPICC field.
>   A deal with paper process not started in the late Proposal/Negotiation stage
>   is a known risk gap (`rules/meddpicc/deal-review.md`).
> - `rules/lawful-basis.md` — data-processing terms (DPA) require a lawful basis
>   to be recorded before they are agreed; the DPA does not create the lawful
>   basis, it documents the processing arrangement.
> - `rules/jurisdiction-routing.md` — the applicable data-processing terms depend
>   on the buyer's jurisdiction. Apply the strictest overlay; default to EU/UK
>   treatment when jurisdiction is unknown.
> - `rules/common/data-handling.md` — prospect PII provenance; attachment quarantine
>   applies to redlined documents received from buyers.
> - `rules/common/selling-principles.md` — no false completion. A document is not
>   "signed" until a tool-result confirms execution. Drafts are drafts.

Paper process is the tracking layer, not the legal drafting layer. This skill
records what document exists, who owns it, what its current status is, what is
blocking it, and when it is expected to resolve. The `close-plan` sequences when
each artifact gate must complete to protect the target close date; this skill
tracks the live status of each artifact inside those gates.

## When to Activate

Activate this skill when:

- A deal enters the Proposal/Negotiation stage and paper process has not yet been
  opened — open it now.
- A stakeholder asks for the status of any legal or procurement document.
- A document is blocked (awaiting redline, awaiting security team response,
  awaiting procurement sign-off) and the blocker needs to be logged and owned.
- A DPA or data-processing addendum is required and the applicable jurisdiction
  needs to be confirmed.
- The close plan references a paper-process gate and needs a current status.
- A buyer's legal team sends redlines and they need to be logged as received.
- Any artifact reaches execution (signed) and the status needs to be updated.

Do **not** activate for:
- Setting the timeline for when each gate must complete — that is `close-plan`.
- The shared buyer+seller milestone view — that is `mutual-action-plan`.
- Negotiation tactics on commercial terms — that is `negotiation-prep`.
- MEDDPICC deal scoring — that is `rules/meddpicc/deal-review.md`.
- Drafting legal language — this skill does not draft contracts; it tracks them.

## The document model

Each artifact tracked under `.claude/escc/deals/<deal-id>/paper/` (workspace-local;
never committed with real customer data) carries:

| Field | Holds |
|---|---|
| `artifact` | document type (MSA / DPA / order-form / security-questionnaire / NDA / other) |
| `status` | not-started / draft-sent / redlines-received / redlines-returned / final / executed |
| `owner` | who is responsible for the next action (rep / buyer-legal / rep-legal / procurement) |
| `blocker` | what is preventing the next status advance, if anything |
| `due` | target completion date (sourced from close-plan gate) |
| `last-updated` | ISO date of the last status change |
| `notes` | version history summary, key open points, jurisdiction flags |

Status transitions are append-only — do not overwrite prior states. The log is
the audit trail.

## Workflow

### Step 1 — Open the paper process for a deal

1. Confirm the deal has a target close date and a close plan. The paper process
   must open early enough for the critical-path gate (typically security review
   for enterprise, legal sign-off for mid-market) to complete before the close
   date. If the close plan has not been built, prompt the rep to build it first.
2. Identify which documents are required for this deal. Defaults by segment:
   - **Enterprise:** MSA (or vendor-provided agreement), DPA (if any personal
     data is processed), order form, security review questionnaire, possibly NDA.
   - **Mid-market:** MSA (often standard template), order form, DPA if required
     by the buyer's data regime.
   - **SMB:** order form or click-through terms; DPA if required; MSA optional.
3. Confirm the jurisdiction for DPA purposes via `rules/jurisdiction-routing.md`.
   Route by the buyer's location, not the seller's. When unknown, apply EU/UK
   treatment until confirmed.
4. Create a paper-process record for each required artifact with initial status
   `not-started` and the target due date from the close plan.

### Step 2 — Track each artifact through its lifecycle

For each artifact, the standard lifecycle is:

```
not-started
  → draft-sent        (seller sends first draft to buyer)
  → redlines-received (buyer returns marked-up version)
  → redlines-returned (seller returns counter-redlines)
    [redlines-received / redlines-returned may repeat]
  → final             (both parties agree on final language)
  → executed          (fully signed; tool-result confirmation required)
```

At each status transition:
1. Update the artifact record: new status, owner, due date, notes on open points.
2. Note any blocker explicitly. A blocker without an owner and a date is a
   hidden risk. Common blockers: buyer legal backlog, internal procurement hold,
   security questionnaire not returned, DPA jurisdiction review pending.
3. If a transition confirms execution (signed), require a tool-result (HubSpot
   activity, DocuSign completion, email confirmation) before marking `executed`.
   A document is not signed until the tool confirms it (`selling-principles §4`).

### Step 3 — Handle DPA and data-processing terms

1. Confirm the buyer's jurisdiction (`rules/jurisdiction-routing.md`). The DPA
   template and the required clauses differ materially across AU (Privacy Act),
   US (state-by-state, CCPA where applicable), and EU/UK (GDPR Standard
   Contractual Clauses or UK IDTA).
2. Confirm the lawful basis for data processing is already recorded on the contact
   (`rules/lawful-basis.md`). The DPA documents the processing arrangement; it
   does not establish the lawful basis retroactively. If lawful basis is missing,
   flag it to the rep before proceeding with DPA negotiation.
3. For EU/UK buyers, confirm whether Standard Contractual Clauses (SCCs) or a
   UK IDTA addendum is required. Flag for legal team review if the processing
   arrangement involves sub-processors or cross-border transfers.
4. Log the jurisdiction determination and the DPA variant in the artifact notes.

### Step 4 — Handle security review questionnaires

1. Log the questionnaire as a separate artifact (`security-questionnaire`) with
   its own status lifecycle.
2. Assign ownership to the rep + solutions engineering / security team
   immediately on receipt. Security reviews are the longest critical-path gate
   for enterprise deals (2-4 weeks); a questionnaire sitting unassigned for a week
   is a direct threat to the close date.
3. Track: questionnaire received, assigned to SE/security, response drafted,
   response sent, buyer review complete, approved.
4. If a security review uncovers a product gap (the buyer's requirement is not
   currently met), escalate to the SE team and flag to the close plan — this is
   a potential deal risk, not just a paper process item.

### Step 5 — Escalate blockers to the close plan

When any artifact is blocked past its due date, or when the expected completion
date slips beyond the window required by the close plan gate:

1. Pull the affected gate from `close-plan` and flag it as at-risk.
2. Identify a specific next action, owner, and date to unblock.
3. Engage the champion to apply internal pressure on the buyer's side where
   the blocker is buyer-controlled (e.g. legal team backlog, procurement hold).
4. Log the escalation in the artifact notes.

### Step 6 — Confirm execution and close the record

1. When an artifact is fully executed, confirm with a tool-result (DocuSign
   completion event, email with signed attachment, HubSpot activity log).
2. Update status to `executed` with the confirmed date.
3. Notify the close plan that the gate is complete.
4. For the order form specifically: a signed order form is a Closed Won trigger.
   Log to HubSpot via `crm-operator`; update the deal stage to Closed Won with
   reason (`rules/lifecycle-stages.md`).

## Examples

**Opening a new enterprise paper process:**

```text
Deal: GlobalCo ($210k ARR), target signature 2026-10-15.
Segment: enterprise. Buyer HQ: Netherlands (EU/UK rules apply).
Close plan gate: paper process must open by 2026-07-28 (today).

Artifacts opened:
  1. MSA
     status: not-started | owner: Rep | due: draft-sent by 2026-07-30
     notes: buyer prefers their paper (vendor paper); legal team to review.
  2. DPA
     status: not-started | owner: Rep + legal | due: draft-sent by 2026-07-30
     notes: EU/GDPR; SCCs required (controller-to-processor). Sub-processors:
       [product team to confirm list]. Lawful basis: legitimate interest, recorded
       2026-05-14 (rules/lawful-basis.md).
  3. Order form
     status: not-started | owner: Rep | due: final by 2026-10-08
     notes: standard template; pricing confirmed by quote-desk 2026-07-25.
  4. Security questionnaire
     status: not-started | owner: Rep | due: send to SE by 2026-07-30
     notes: enterprise; expect 3-4 week review. Critical-path gate.
```

**Tracking an in-flight paper process:**

```text
Deal: NovaCorp, status update 2026-08-20.

Artifact: MSA
  status: redlines-received (buyer returned 2026-08-18)
  owner: Rep legal team (response due 2026-08-25)
  blocker: none — legal team has the redlines
  open points: liability cap, indemnification clause — standard negotiation.

Artifact: DPA
  status: draft-sent (sent 2026-08-10)
  owner: Buyer legal
  blocker: buyer legal team on leave until 2026-08-22 — expected response 2026-08-26
  notes: US buyer (California); CCPA addendum included. No SCCs required.

Artifact: Security questionnaire
  status: response-sent (sent to buyer 2026-08-15)
  owner: Buyer InfoSec
  due: 2026-09-05
  blocker: none — waiting on buyer review
  notes: SE confirmed all requirements met; no product gaps identified.

Artifact: Order form
  status: not-started | owner: Rep | due: 2026-09-20
  notes: waiting on MSA and DPA to reach final before sending order form.

Close plan gate impact: MSA redlines on track. DPA may slip 2 days (buyer leave).
  No gate impact unless DPA response delays beyond 2026-08-28.
```

**DPA jurisdiction determination:**

```text
Buyer: Osaka Financial Services, operations in Japan and UK.
Jurisdiction routing (rules/jurisdiction-routing.md):
  - Multiple jurisdictions: JP + UK.
  - Strictest applicable: UK GDPR (PECR + UK IDTA).
  - Apply UK IDTA addendum, not standard EU SCCs.
  - Lawful basis: legitimate interest for B2B contact (recorded); contract
    basis for data processing under the DPA.
  → Open DPA artifact with UK IDTA template; flag for legal team review.
  → Record jurisdiction determination in artifact notes.
```

**Security questionnaire — gap identified:**

```text
Buyer: Example Co InfoSec questionnaire returned 2026-08-22.
Item 43: "Does the vendor support on-premise deployment?"
  Answer required: YES — buyer's policy prohibits SaaS for this data class.

Assessment: product is SaaS-only. This is a product gap, not a paper process item.
Action:
  1. Escalate to SE and AE immediately.
  2. Flag in close plan as deal-risk (not just paper-process blocker).
  3. Do not state the product supports on-premise deployment (selling-principles §2).
  4. Engage champion to understand whether an exception process exists or whether
     this is a hard blocker.
  Status of artifact: BLOCKED — pending deal-risk resolution.
```

## Anti-patterns

- **Treating paper process as an afterthought.** Opening the paper process in the
  final two weeks of an enterprise deal is the most common cause of missed close
  dates. Open it at stage 4 entry, not when the buyer asks.
- **Marking a document executed without tool-result confirmation.** A verbal "it's
  signed" is not signed. A draft is a draft. Confirm execution with a DocuSign
  event, a CRM activity, or a confirmed email before updating the status
  (`selling-principles §4`).
- **Ignoring jurisdiction for DPA.** Applying a generic DPA template to an EU buyer
  without SCCs, or a UK buyer without a UK IDTA, creates compliance exposure.
  Always route jurisdiction first (`rules/jurisdiction-routing.md`).
- **Missing the security questionnaire as a separate artifact.** Treating the
  security review as a single yes/no gate hides its internal lifecycle (received /
  assigned / response-sent / approved). Untracked questionnaires disappear into
  inboxes and blow up close dates.
- **Letting blockers sit without an owner and date.** A blocker logged without an
  owner and resolution date is invisible. Every blocker gets an owner and a date.
- **Conflating paper-process status with close-plan gating.** This skill tracks
  artifact status; `close-plan` owns whether the gate is on track for the close
  date. Keep the two in sync — do not embed close-date analysis here.
- **Processing buyer-supplied legal documents outside the quarantine boundary.**
  Redlined documents received from buyers are prospect-supplied content and must
  be handled per `rules/common/data-handling.md` attachment-quarantine rules.
  Privileged agents receive only the cleaned summary; they do not process raw
  attachment bytes.

## Related

- `close-plan` — sequences when each paper-process gate must complete to protect
  the close date. Paper-process feeds gate status into close-plan; close-plan
  sequences the gates.
- `mutual-action-plan` — the shared buyer+seller milestone plan. Buyer-visible
  milestones (e.g. "legal review complete by [date]") may appear there; the
  per-artifact status log lives here, not there.
- `rules/meddpicc/qualification.md` — P (paper process) is a MEDDPICC field.
  A red P means paper process is not started or is materially blocked; it gates
  deal stage advance.
- `rules/meddpicc/deal-review.md` — paper process status contributes to the
  deal's amber/red scoring.
- `rules/lawful-basis.md` — lawful basis must be recorded before DPA negotiation;
  the DPA documents the arrangement, it does not create the basis.
- `rules/jurisdiction-routing.md` — determines which DPA template and clauses
  apply; route by buyer location, apply the strictest overlay.
- `rules/common/data-handling.md` — prospect PII; attachment quarantine for
  buyer-supplied redlined documents.
- `rules/common/selling-principles.md` — no false completion; execution confirmed
  by tool-result only.
