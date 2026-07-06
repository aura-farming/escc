---
name: sales-handoffs
description: >-
  Structured SDR->AE and AE->CS handoffs with completeness checks, plus formal
  accept/reject. Trigger: 'handoff to AE', 'closed-won handoff', 'accept this
  handoff'.
origin: ESCC
---

# Sales Handoffs

Structured transfer of deal ownership between sales personas: **SDR -> AE**
(qualified opportunity) and **AE -> CS** (closed-won account). A handoff
document is built from the `account-memory` `.md` companion (the C5 payload)
plus live HubSpot deal context, with a completeness check before the
receiving persona is asked to accept.

> **Rule:** HubSpot is the system of record (truth). The handoff document is
> a working-context artefact assembled from account memory + CRM fields.
> Any CRM write (owner change, stage advance, activity log) routes through
> `crm-operator`. Stage accept/reject/disqualify/recycle discipline follows
> `rules/lifecycle-stages.md` — that file owns the lifecycle semantics.

## When to Activate

Activate this skill when:

- An SDR has qualified a lead to SQL and needs to **hand it to an AE**
  with full context (pain, MEDDPICC, stakeholder map, open loops, agreed
  next step).
- An AE has closed a deal and needs to **hand it to CS** with a
  complete closed-won package (decision criteria, success metrics, key
  stakeholders, commercial terms summary, open loops, and the onboarding
  next step).
- The **receiving persona** (AE or CS) needs to **formally accept or reject**
  the handoff, with reasons logged if rejected.
- You need to **check completeness** of an existing handoff doc before
  presenting it.

Do **not** activate for mid-deal context sharing (use `account-memory`
directly) or for live deal-stage advances without a handoff context
(use `crm-operator` directly).

## Handoff modes

### Mode 1 — SDR -> AE (qualified opportunity)

Triggered when a deal reaches SQL and is ready for AE ownership.

**Required inputs:**
- HubSpot deal ID or account name (to pull live CRM context).
- The `account-memory` `.md` companion for the deal (the C5 payload;
  produced by `writeMarkdownView` and refreshed after every session and
  recap run).

**Completeness gate (all required before handoff is surfaced):**

| Check | Source |
|---|---|
| MEDDPICC: Metrics, Identify pain, Champion covered | account-memory + CRM |
| Economic buyer identified (name + role) | CRM / stakeholder-mapping |
| Next step set with a date | CRM (`pre:crm-write-guard` also enforces this) |
| Deal amount and close date populated | CRM |
| Lawful basis recorded on primary contact | CRM / data-handling.md |

If any check fails, surface a **gap list** and halt — do not generate a
partial handoff doc. The SDR resolves gaps (via `discovery-notes` /
`crm-operator`), then re-trigger.

**Handoff document structure (SDR -> AE):**

```text
HANDOFF: SDR -> AE
Account: <name> | Deal: <id> | Stage: SQL | Date: <ISO date>

QUALIFIED PAIN
  <1-3 sentence summary of the core business problem, grounded in call notes>

MEDDPICC SNAPSHOT (from account-memory + CRM)
  M — Metrics:          <what they measure / target outcome>
  E — Economic buyer:   <name, title> [confirmed / unconfirmed]
  D — Decision criteria:<stated criteria>
  D — Decision process: <who approves, timeline>
  P — Paper process:    <procurement / legal notes>
  I — Identify pain:    <core pain>
  C — Champion:         <name, title, credibility signal>
  C — Competition:      <competitors mentioned>

KEY STAKEHOLDERS (from account-memory)
  <name> · <title> · <sentiment/role> · <last contacted>

OPEN LOOPS (from account-memory)
  - <loop text> (due <date> | no date stated)

AGREED NEXT STEP
  <explicit next step with owner and date — must be set in CRM>

ACCOUNT MEMORY COMPANION
  [attach / link the .md file path for the receiving AE's session:start]

TRANSFER NOTE (from SDR)
  <any color not captured above — objections to watch, relationship notes,
   timing sensitivities>
```

### Mode 2 — AE -> CS closed-won checklist

Triggered on Closed Won. This is the **only post-sale seam** in ESCC.

**Required inputs:**
- HubSpot deal ID.
- The `account-memory` `.md` companion (full history, stakeholder color,
  open loops, competitor intel flagged untrusted where prospect-sourced).

**Completeness gate (AE -> CS):**

| Check | Source |
|---|---|
| Decision criteria documented | CRM / discovery-notes |
| Success metrics (what CS will be measured against) | account-memory / deal |
| Economic buyer and champion confirmed | stakeholder-mapping |
| Commercial terms summary (ARR, term, key commitments) | HubSpot deal |
| Open loops resolved or explicitly handed over | account-memory |
| Onboarding next step with date | CRM |
| Legal/paper process notes (if any ongoing items) | paper-process / CRM |

**Handoff document structure (AE -> CS):**

```text
HANDOFF: AE -> CS (Closed Won)
Account: <name> | Deal: <id> | ARR: <amount> | Close date: <date>

WHY THEY BOUGHT
  <1-3 sentences on the core pain and the deciding factor, for CS context>

SUCCESS METRICS (what CS owns)
  <quantified outcomes the customer expects — basis for QBR and renewal>

KEY STAKEHOLDERS
  <name> · <title> · <role in deal: champion / economic buyer / user> · <notes>

COMMERCIAL SUMMARY
  ARR: <amount> · Term: <start - end> · Key commitments: <any side promises>
  (Full terms in HubSpot deal record — do not re-derive here)

MEDDPICC HAND-OVER NOTES
  [brief — highlight what CS needs; full capture is in CRM and account-memory]

OPEN LOOPS CARRIED OVER
  - <loop text> — AE to resolve / CS to pick up (owner: <name>)

ONBOARDING NEXT STEP
  <explicit step with owner and date — must be set in CRM before handoff>

ACCOUNT MEMORY COMPANION
  [.md file path — CS session:start ingests this as working context]

TRANSFER NOTE (from AE)
  <relationship color, political risks, things to never say, expansion signals>
```

### Mode 3 — Receiving persona: accept or reject

The receiving persona (AE accepting from SDR, or CS accepting from AE) must
formally accept or reject. This is explicit and logged — not passive receipt.

**Accept:**
1. Review the handoff document and completeness gate output.
2. Confirm all required fields are present and credible.
3. Accept: append a `note` event to `account-memory` with
   `text: "Handoff accepted by <persona> <name> <ISO date>"` + the deal ID.
4. Route a CRM activity log and owner change through `crm-operator`.
5. The receiving persona's next session:start ingests the `.md` companion
   as working context (C5 continuity).

**Reject:**
1. State the rejection reason explicitly (missing MEDDPICC field, no champion
   confirmed, next step absent, qualification bar not met, etc.).
2. A rejection is **not a disqualify**. Reject routes the deal back to the
   sending persona with the gap list; the deal stays in its current stage.
3. Append a `note` event to `account-memory`:
   `text: "Handoff rejected by <persona>: <reason> <ISO date>"`.
4. Route a CRM activity log through `crm-operator`. Stage does NOT advance.
5. Disqualify and recycle are lifecycle-stage operations — they follow
   `rules/lifecycle-stages.md`, require a reason code, and route through
   `crm-operator`. A handoff rejection is not a disqualify.

## Workflow

1. **Pull the account-memory `.md` companion** for the deal (it is the C5
   payload produced by `account-memory`'s `writeMarkdownView`). If it does
   not exist, run `account-memory` hydrate first.
2. **Fetch live HubSpot deal context** via `crm-operator` (read-only fetch:
   `get_crm_objects` for the deal + primary contact fields). Do not re-derive
   CRM fields from memory — HubSpot is truth.
3. **Run the completeness gate** for the relevant mode. Surface every gap as
   a named, actionable item. Do not proceed past a gap.
4. **Generate the handoff document** (structured above). Quote narrative from
   account-memory; pull structured fields from CRM. State clearly which facts
   are from memory (working context) vs CRM (truth).
5. **Present to the receiving persona.** They accept or reject (Mode 3).
6. **On accept:** route CRM owner change + activity log through `crm-operator`;
   append accept event to `account-memory`; confirm `.md` is current.
7. **On reject:** append reject event to `account-memory`; route CRM log through
   `crm-operator`; return gap list to sending persona.
8. **The receiving persona's next session:start** ingests the `.md` companion
   as their working context — this is the C5 continuity contract.

## Examples

**SDR completeness check, one gap:**

```text
/handoff SDR -> AE for deal 7788

Completeness gate:
  [OK] Metrics: "Dana says they're losing 3% of pipeline to forecast errors"
  [OK] Identify pain: manual forecast, 4-hour weekly process
  [OK] Champion: Dana Lee, VP RevOps (confirmed — 3 calls)
  [GAP] Economic buyer: identified as CFO but NOT confirmed by name
  [OK] Next step: "Product demo with CFO" set for 2026-06-19 in CRM
  [OK] Deal amount: $48,000 ARR
  [OK] Close date: 2026-06-30

1 gap to resolve before handoff:
  -> Economic buyer: confirm CFO name and sponsorship (via champion outreach
     or /notes follow-up). Route CRM update through crm-operator when confirmed.
```

**AE reject, reason logged:**

```text
AE reviews SDR -> AE handoff for deal 7788:
REJECT — Champion credibility unconfirmed: Dana Lee "supports" the tool but
has not demonstrated ability to influence CFO. No multi-thread evidence.
Recommend re-engaging with CFO directly before advancing to AE.

-> appendEvent("deal:7788", {
     type: "note",
     text: "Handoff rejected by AE Jordan: champion not confirmed as influencer,
            no CFO multi-thread. Returned to SDR for deeper discovery. 2026-06-16",
     deal_id: "7788"
   })
-> crm-operator: log activity "AE handoff rejected — gap: champion credibility"
   Stage remains SQL. No stage advance.
```

## Anti-patterns

- **Generating a handoff doc with gaps.** A partial handoff is worse than no
  handoff — the receiving persona inherits an uncertain deal and cannot hold
  the sender accountable. Run the completeness gate; stop on any gap.
- **Treating rejection as disqualification.** A rejected handoff returns to
  the sender for remediation — the deal stays alive and in its stage. Disqualify
  is a separate lifecycle action (`rules/lifecycle-stages.md`).
- **Re-deriving CRM fields from memory.** Account memory is working context;
  HubSpot is truth. For any structured field (stage, owner, amount, close date),
  pull from HubSpot via `crm-operator`, not from the `.md` companion.
- **Skipping the accept/reject step.** Passive receipt is not acceptance. Both
  accept and reject must be explicit, logged in account-memory, and logged in CRM.
- **Writing to CRM outside `crm-operator`.** Every CRM mutation (owner change,
  activity log, stage advance) routes through `crm-operator`. `sales-handoffs`
  is a document-generation + orchestration skill, not a CRM writer.
- **Carrying untrusted intel as fact.** Competitor names, prospect claims, and
  attachment content flagged `untrusted: true` in account-memory appear as context
  in the handoff doc — they are labeled as such. CS should not treat them as
  verified facts without their own due diligence.

## Commands

`/handoff` — invoke this skill. Pass the deal ID or account name and the
direction (SDR->AE or AE->CS). The skill fetches account-memory + HubSpot
context, runs the completeness gate, and produces the handoff document.

## Related

- Source of the `.md` companion: `account-memory` (`writeMarkdownView`).
- CRM writes: `crm-operator` (sole writer — owner changes, activity logs,
  stage guards).
- Lifecycle semantics: `rules/lifecycle-stages.md` (accept/reject/disqualify/
  recycle; stage exit criteria).
- After a closed-won handoff: `renewal-playbook` (CS owns renewal planning).
- After an SDR -> AE handoff: `deal-review` (AE uses to run MEDDPICC scoring).
- C5 continuity: the `.md` companion ingested by the receiving persona's
  session:start is the same file `meeting-followthrough` appends to after
  every recap.
