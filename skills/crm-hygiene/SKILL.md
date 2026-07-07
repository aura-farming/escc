---
name: crm-hygiene
description: >-
  HubSpot data-health enforcement — required fields by stage, stale records,
  duplicates, logging compliance. Trigger: 'CRM cleanup', 'data quality
  check', 'fix missing fields', 'why is my forecast wrong'.
origin: ESCC
---

# CRM Hygiene

Operationalizes `rules/common/crm-hygiene.md` — the standards that keep
HubSpot trustworthy enough to forecast from and coach from. This skill
defines what "good" looks like, how to detect deviations, and how to
route remediation safely.

> **Rule:** HubSpot is the system of record (truth). All writes — field
> updates, stage advances, activity logs, and merges — route through
> `crm-operator` exclusively. This skill identifies and prioritizes
> hygiene gaps; it does not write to HubSpot directly.
>
> **Dedupe boundary:** This skill flags duplicate records and routes the
> merge to `dedupe-merge` + `crm-operator`. Survivorship logic and
> association preservation are owned by `dedupe-merge` — this skill
> does not apply merges or decide which record survives.

## When to Activate

Activate this skill when:

- A rep or manager needs to know **which deals are missing required fields**
  for their current stage before a forecast or pipeline review.
- You need to **audit activity-logging compliance** — calls, meetings, and
  email threads that should be logged against deals and contacts but are not.
- You need to **find and flag duplicate** contacts or companies before
  creating a new record.
- You are running a **data-health audit** across the pipeline (Mode A.5
  below) to produce a prioritized cleanup list.
- A deal is **stale** — last activity or stage-advance is older than it
  should be — and you want a structured alert.
- You want to confirm **naming conventions** are followed before a bulk
  import or a new deal is created.

Do **not** activate to apply merges (route to `dedupe-merge` + `crm-operator`)
or to advance stages (route to `crm-operator` with `lifecycle-stages.md`
exit criteria).

## Standards (from `rules/common/crm-hygiene.md`)

### Required fields by stage

Every open deal must have: `amount`, `close_date`, `dealstage`, a `next_step`
**with a date**, and an identified champion or primary contact. Stage advances
require the destination stage's exit criteria to be recorded
(`rules/lifecycle-stages.md`). The `pre:crm-write-guard` hook warns or blocks
a stage advance with no next step.

| Deal stage | Minimum required fields |
|---|---|
| Discovery | amount (estimated OK), close_date, next_step+date, primary contact |
| Qualification | + economic buyer identified, MEDDPICC metrics + pain logged |
| Validation / Proof | + decision criteria, success metrics, POC scope |
| Proposal / Negotiation | + proposal sent date, approver identified (`approval-matrix`) |
| Closed Won / Lost | + closed reason, win/loss reason code, CS owner (Won) |

Contacts at every stage must carry: `role/title`, `lawful_basis` (GDPR field,
per `rules/common/data-handling.md`), and a `source` field.

### Activity-logging standards

Log every meaningful interaction against the contact AND the deal — promptly,
same day where possible:

- Calls: log disposition (connected / VM / no answer) + brief notes.
- Meetings / demos: log with attendees and outcome.
- Email threads: log the thread or a summary when a substantive exchange occurs.
- Default behaviors (seed instincts): `log-activity-after-meeting`,
  `log-call-disposition-after-dial`.

A deal with `last_activity_date` older than the rep's expected cadence is a
hygiene defect — surface it in the data-health audit.

### Naming conventions

Consistent deal naming: `[Account] — [Use case or Product] — [New | Renewal | Expansion]`.

Examples:
- `Example Co Corp — Forecast Module — New`
- `Globex — Enterprise Renewal — Renewal`
- `Initech — Expansion Seats — Expansion`

Deviation from this pattern makes pipeline reporting and filtering unreliable.
Flag non-conforming deal names in the audit.

### Association integrity

Contacts, companies, and deals must be associated correctly. An orphaned deal
(no company), an orphaned contact (no company), or a deal with no primary
contact is a data-quality defect — surface it with remediation priority P1.

### Dedupe-first rule

Before creating a company or contact record, search for an existing record.
**Never create a duplicate.** If a potential duplicate is found:
1. Flag it with the matching record IDs and a confidence signal
   (exact email match / domain match / name similarity).
2. Route the merge to `dedupe-merge` (for survivorship + association
   preservation logic) + `crm-operator` (for the actual merge write).
3. Do not apply the merge here. Do not decide which record survives here.

## Mode A.5 — Data-health audit

A structured scan across the pipeline that produces a **prioritized cleanup list**.

### Audit scope

Run against: all open deals (default) or a specified stage/owner/date range.

### Audit checks (run in this order)

1. **Missing required fields** — for each deal, check the field requirements
   table above against its current stage. Flag every gap.
2. **No next step or stale next step** — deals with `next_step` empty or
   `next_step_date` in the past. Priority: P1 (blocks stage advance).
3. **Stale last activity** — deals where `last_activity_date` is older than
   the rep's expected cadence (default: 7 days for active stage; 14 days for
   late stage). Priority: P2.
4. **Activity-logging gaps** — deals with meetings or calls in the last 14
   days (per calendar / Fireflies) that have no corresponding CRM activity.
   Priority: P3.
5. **Non-conforming deal names** — names that do not match
   `[Account] — [Use case] — [Type]`. Priority: P4.
6. **Association defects** — orphaned deals, orphaned contacts, deals with
   no primary contact. Priority: P1.
7. **Potential duplicates** — contacts or companies with matching email
   domains, similar names, or duplicate HubSpot IDs. Flag with confidence
   signal; route to `dedupe-merge`. Priority: P1 when confirmed match.
8. **Forecast-category / stage mismatch** — deals whose forecast category
   is inconsistent with stage (`rules/common/forecasting-definitions.md`
   owns the category definitions). Priority: P1 (corrupts forecast roll-up).

### Audit output format

Cleanup priority (P1-P4) ranks data-health remediation work; it is distinct from the deal-alert severity rubric (Critical / High / Medium / Low) owned by `pipeline-hygiene`.

```text
DATA-HEALTH AUDIT: <scope> · <date>
<n> deals scanned · <n> gaps found

PRIORITY: P1
  [MISSING FIELD] deal:7788 "Example Co Corp — Forecast Module — New"
    Stage: Qualification · Missing: economic_buyer_name
    Remediation: add via /notes or directly in HubSpot -> crm-operator
  [ORPHANED DEAL] deal:9901 "Initech — Expansion Seats — Expansion"
    No primary contact associated.
    Remediation: associate contact -> crm-operator

PRIORITY: P2
  [STALE NEXT STEP] deal:4455 "Globex — Enterprise Renewal — Renewal"
    next_step_date: 2026-05-30 (overdue 17 days). Stage: Proposal.
    Remediation: confirm status with rep; update or advance/close.

PRIORITY: P3
  [ACTIVITY GAP] deal:7788 "Example Co Corp — Forecast Module — New"
    Meeting logged in Fireflies 2026-06-15; no CRM activity entry found.
    Remediation: /recap to log via meeting-followthrough or log manually
    via crm-operator.

PRIORITY: P4
  [NAMING] deal:6633 "ACME New Business"
    Does not match [Account] -- [Use case] -- [Type] convention.
    Remediation: rename via crm-operator.

POTENTIAL DUPLICATES (route to dedupe-merge)
  contact:1001 "dana.lee@acme.example" / contact:1042 "d.lee@acme.example"
    Confidence: HIGH (same domain, similar name). Do not merge here.
    -> Route to dedupe-merge + crm-operator.

SUMMARY
  Critical (P1): 3 items
  Elevated (P2): 1 item
  Standard (P3): 1 item
  Low (P4): 1 item
  Duplicates to route: 1 pair
```

### Remediation routing

| Gap type | Route to |
|---|---|
| Missing CRM field | `crm-operator` (direct write after rep confirms value) |
| Stage advance with unmet exit criteria | `crm-operator` + `rules/lifecycle-stages.md` |
| Activity not logged | `meeting-followthrough` (for transcripts) or `crm-operator` (manual) |
| Duplicate record | `dedupe-merge` (survivorship) + `crm-operator` (merge write) |
| Forecast/stage mismatch | `crm-operator` + `rules/common/forecasting-definitions.md` |
| Association defect | `crm-operator` |

## Workflow

### A. Pre-create check (single record)

1. Before creating a company or contact: search HubSpot for existing records
   (email domain, company name) via `crm-operator` read tools.
2. If a potential duplicate is found: flag it with IDs and confidence; route
   to `dedupe-merge`. Do not create the record until the duplicate question
   is resolved.
3. If no duplicate: proceed. Apply naming convention and required fields from
   the start — do not create a record that will immediately fail a hygiene check.

### B. Pre-commit field check (single deal)

1. Before a rep advances a stage: run the required-fields check for the
   destination stage (table above).
2. Surface any gap as a named, actionable item. The `pre:crm-write-guard`
   hook will independently block a stage advance with no next step.
3. If all checks pass: proceed via `crm-operator`.

### C. Data-health audit (Mode A.5)

1. Determine scope (all open deals, or filter by stage / owner / date range).
2. Fetch deal and contact records via `crm-operator` read tools.
3. Run audit checks 1-8 in order. Accumulate gaps with priority.
4. Produce the audit output (structured above).
5. Route each item to its remediation owner (table above).
6. Do not apply any write in this skill. Every remediation is a separate,
   approved action through `crm-operator` or `dedupe-merge`.

## Examples

**Pre-create duplicate check:**

```text
Rep wants to create contact "dana.lee@acme.example".
-> crm-operator: search_crm_objects contacts email:"dana.lee@acme.example"
   FOUND: contact:1001 "Dana Lee" acme.example (created 2026-03-10)
-> FLAG: potential duplicate (confidence: HIGH — exact email match).
   Do not create. Route to dedupe-merge for survivorship review.
   Rep: confirm this is the same person; if yes, use contact:1001 or
   merge via dedupe-merge + crm-operator.
```

**Stage advance blocked — missing field:**

```text
Rep wants to advance deal:7788 from Discovery to Qualification.
Required fields check (Qualification):
  [OK]  amount: $48,000
  [OK]  close_date: 2026-06-30
  [OK]  next_step: "Send ROI model" due 2026-06-18
  [GAP] economic_buyer_name: empty
  [GAP] meddpicc_metrics: empty
-> BLOCK: 2 required fields missing for Qualification.
   Remediation:
     1. Confirm economic buyer name with champion; log via crm-operator.
     2. Log metrics from discovery call via meeting-followthrough / crm-operator.
   Re-run check after both are logged.
```

**Audit finding — activity gap:**

```text
Audit detects: deal:7788 has a Fireflies transcript from 2026-06-15
but no CRM activity entry for that date.
-> P3: [ACTIVITY GAP]
   Remediation: run /recap for the 2026-06-15 transcript to log via
   meeting-followthrough -> crm-operator. Or log manually via crm-operator
   if the transcript is unavailable.
```

## Anti-patterns

- **"Happy ears" stage advances.** A deal does not advance because a rep
  feels good about the call. Exit criteria must be met and recorded.
  `pre:crm-write-guard` enforces the next-step requirement; this skill
  enforces the field requirements.
- **Creating a duplicate to avoid a merge conversation.** Search first.
  A duplicate is a data defect that compounds — flag and route.
- **Applying a merge in this skill.** Survivorship and association
  preservation are owned by `dedupe-merge`. Flag here; route there.
- **Bulk field edits without a `crm-operator` review-pack.** Any change
  to more than one record is a bulk write — it requires a review-pack
  and approval before apply (`crm-operator` enforces this).
- **Close-date sandbagging or pull-ins the deal cannot support.** A close
  date must reflect the deal's actual expected close, not a number that
  flatters the forecast. Flag unrealistic dates in the audit.
- **Logging activity after the fact without dating it correctly.** A call
  logged two weeks late with today's date corrupts activity cadence data.
  Log with the actual interaction date.
- **Letting a stale record sit without escalating.** A deal with no next
  step and no activity in 14+ days is not just a hygiene defect — it is a
  pipeline risk. Surface it with priority P2 and a clear owner.

## Related

- Governing rule: `rules/common/crm-hygiene.md` (this skill operationalizes it).
- Stage requirements: `rules/lifecycle-stages.md` (owns exit criteria,
  accept/reject/disqualify/recycle semantics).
- Forecast categories: `rules/common/forecasting-definitions.md` (owns
  category definitions; audit check 8 cites it).
- Merge logic: `dedupe-merge` (owns survivorship + association preservation;
  this skill flags, dedupe-merge decides).
- CRM writer: `crm-operator` (sole write agent — all field updates, activity
  logs, and merges route through it).
- Activity logging: `meeting-followthrough` (for transcript-sourced activity
  logs); `crm-operator` (for manual activity entries).
- Provenance: `rules/common/data-handling.md` + `schemas/provenance.schema.json`
  (lawful basis and source fields required on contacts).
