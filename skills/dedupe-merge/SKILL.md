---
name: dedupe-merge
description: >-
  Use when duplicate CRM records need to be detected, evaluated, and merged —
  two contacts for the same person, two companies for the same account, two deals
  that represent the same opportunity, or any ownership conflict that is rooted in
  a duplicate. Trigger on "merge duplicates", "dedupe", "which record survives",
  "we have two records for the same company", "clean up this duplicate", "merge
  these contacts", or any request to resolve a record collision before routing,
  forecasting, or reporting can be trusted.
origin: ESCC
---

# Dedupe Merge

The canonical owner of survivorship rules and association-preservation logic for
ESCC. Every merge of duplicate CRM records — contacts, companies, deals — runs
through this skill. Other skills that encounter a duplicate situation cite this
skill and defer; they do not define their own survivorship logic.

> **This skill OWNS survivorship and association-preservation rules.** Other skills
> cite these by name and point here. Do not define a competing merge model elsewhere.
>
> **Governing rules (DEFER for policy; this skill owns the merge mechanics):**
> `rules/common/crm-hygiene.md` — CRM data standards; dedupe-first is a hygiene
> rule enforced here.
> `rules/lifecycle-stages.md` — a disqualify/recycle is a status + reason, NEVER
> a delete. No record is removed from HubSpot as a byproduct of a merge.
>
> **All merges are crm-operator writes requiring explicit approval.** A merge is
> proposed as a review-pack (survivor + losing record + field/association
> resolution); `crm-operator` applies it only after the approval is confirmed.
> No merge is applied speculatively or in bulk without a review-pack.

## When to Activate

Activate this skill when:

- A **duplicate company or contact is found** before a new record would be created
  (pre-creation deduplication, per `rules/common/crm-hygiene.md`).
- Two or more records in HubSpot **represent the same real-world entity** and
  need to be collapsed into one authoritative record.
- A **routing conflict** is rooted in duplicate records — two reps own different
  HubSpot records for the same company.
- A **forecasting or reporting anomaly** is caused by the same deal appearing
  under two records.
- Someone asks **"which record survives?"** and needs a principled answer, not
  a coin flip.
- A merge has been partially executed (e.g. one contact merged, associated deal
  orphaned) and needs to be completed or repaired.

Do not activate for routing a clean (non-duplicate) lead (that is `lead-routing`),
for disqualifying or recycling a valid record (that is `rules/lifecycle-stages.md`),
or for bulk data imports where deduplication is an ETL concern upstream of ESCC.

## Survivorship rules (canonical — other skills defer here)

When two records represent the same real-world entity, one becomes the survivor
(retained, enriched) and the other becomes the loser (merged in, then archived).
Apply these rules in order; the first match determines the survivor.

### Company survivorship (priority order)

1. **More associated records wins.** The company record with more associated
   contacts, deals, and activities is the survivor. It carries more history and
   is more likely to be the "real" master record.
2. **Older creation date wins** when association counts are equal. The earlier
   record is more likely to have been created deliberately; the newer one is
   more likely to be a duplicate entry.
3. **More complete required fields wins** when creation dates are close (within
   30 days). Count the required fields from `rules/common/crm-hygiene.md`
   that are populated; the record with more populated required fields is the survivor.
4. **Named-account record wins** when one record is explicitly on a named-account
   list and the other is not. The named-account record carries intentional enrichment.
5. **Manual override.** A rep or manager may explicitly designate the survivor
   when the rules are ambiguous. This override is recorded in the review-pack.

### Contact survivorship (priority order)

1. **Associated to a deal wins.** A contact linked to an open or closed deal is
   the survivor; an unassociated duplicate is the loser.
2. **More recent meaningful activity wins** when both are deal-associated. The
   contact with the most recent logged call, meeting, or email is the active
   record and is preferred as survivor.
3. **More complete required fields wins** when activity dates are within 14 days.
4. **Do not merge contacts across different companies** without explicit approval.
   A contact that has moved companies is a relationship update, not a duplicate merge.

### Deal survivorship (priority order)

1. **Later pipeline stage wins.** The deal further along the funnel is the
   authoritative deal; the earlier-stage duplicate is the loser.
2. **Higher net ACV wins** when stages are equal. The larger deal is more likely
   to reflect complete information.
3. **More MEDDPICC fields populated wins** when ACV is within 10%.
4. **Do not merge deals across different close-date quarters** without explicit
   approval. A deal in Q3 and a deal in Q4 for the same company may represent
   genuinely separate opportunities.

## Association-preservation rules (canonical)

Losing records carry history and relationships that must not be discarded.
Every merge must preserve:

- **All contacts** associated to the losing record are re-associated to the survivor.
- **All deal associations** on the losing record are re-associated to the survivor.
- **All activity history** (calls, emails, meetings, notes) on the losing record
  is merged into the survivor's timeline.
- **Engagement data** (email opens, clicks, form submissions) is preserved on the
  survivor or flagged if the marketing platform handles deduplication separately.
- **Custom field data** from the losing record is preserved in the survivor if
  the survivor's equivalent field is blank. If both records have a value for
  the same field, the survivor's value is kept and the losing record's value is
  noted in the review-pack for manual review.

Association preservation is non-negotiable. A merge that orphans a deal, drops
activity history, or loses a contact association is worse than leaving the
duplicate in place.

## The review-pack (required for every merge)

Every merge is proposed as a review-pack before `crm-operator` applies it.
No merge happens without an explicit approval of the review-pack.

```text
MERGE REVIEW-PACK: <object type> merge
APPROVAL REQUIRED before apply.

Survivor: <record name> (HubSpot ID: <id>)
  Created: <date> | Associations: <n contacts, n deals, n activities>
  Required fields populated: <list>

Losing record: <record name> (HubSpot ID: <id>)
  Created: <date> | Associations: <n contacts, n deals, n activities>
  Required fields populated: <list>

Survivorship rule applied: <rule name and rationale>

Field conflicts (both records have a value — survivor value kept unless noted):
  field_name: survivor value "<X>" vs losing value "<Y>" -> KEEPING: <which>
  [repeat for each conflict]

Associations being re-associated to survivor:
  - <contact name> (currently on losing record) -> survivor
  - <deal name> (currently on losing record) -> survivor
  - [etc.]

Activity history: <n> activities from losing record will merge into survivor timeline.

Ownership: survivor is currently owned by <rep name>.
  [If losing record has a different owner: flag for routing review post-merge.]

Post-merge: losing record archived, not deleted.
APPLY ONLY AFTER EXPLICIT APPROVAL.
```

## Workflow

### A. Detect and evaluate a duplicate

1. **Search for the record before creating a new one.** Per `rules/common/crm-hygiene.md`:
   search by company name, domain, email, and phone before creating. If a match is
   found, this workflow begins.
2. **Pull both records** via `crm-operator` (read). Capture all fields,
   association counts, and activity history for each.
3. **Apply survivorship rules** in order for the object type (company / contact /
   deal). Identify the survivor and the losing record. State the rule that applied
   and why.
4. **Identify field conflicts.** For every field where both records have a value,
   note the conflict. The survivor's value is kept by default; any case where the
   losing record's value is more complete or more recent is flagged for manual review.
5. **List all associations on the losing record** that must be re-associated to the
   survivor: contacts, deals, activities, engagement data.
6. **Check for ownership conflict.** If the two records have different owners,
   surface this before merging. Routing ownership must be resolved per
   `lead-routing` after the merge — do not silently adopt the survivor's owner
   without flagging it.

### B. Build and submit the review-pack

1. Produce the review-pack in the format above.
2. Surface it to the approver (manager or RevOps). Do not apply the merge
   before approval is confirmed.
3. Record `merge_approval_requested` via `crm-operator` / `governance-capture`
   against the record.

### C. Apply the merge (after approval)

1. **Confirm the approval.** `crm-operator` checks that the merge approval is
   on-record before applying any write. Approval must be explicit — a verbal
   acknowledgement is not sufficient.
2. **Re-associate all losing-record associations** to the survivor:
   - Re-associate contacts (crm-operator write)
   - Re-associate deals (crm-operator write)
   - Merge activity history into survivor timeline (crm-operator write)
3. **Resolve field conflicts** per the review-pack decisions.
4. **Archive the losing record.** The losing record is archived, not deleted.
   Its HubSpot ID is preserved in the survivor's activity log so the merge
   is fully traceable.
5. **Log the merge.** `crm-operator` writes to the activity log:
   - Survivor ID, losing record ID
   - Survivorship rule applied
   - Approver name and timestamp
   - List of re-associations made
   - Any field conflicts and how they were resolved
6. **Read back the survivor record** to confirm all associations are present.
   Report what was merged and verify no associations are missing.

### D. Resolve a routing conflict rooted in a duplicate

1. Identify the two records and the two ownership claims.
2. Run workflow A to determine survivorship.
3. Build the review-pack, including the ownership conflict note.
4. After merge approval and apply (workflow C), route the survivor's ownership
   via `lead-routing` using the correct assignment rule (named-account /
   territory / round-robin from `rules/routing-rules.md`).

## Examples

**Pre-creation dedup: company match found**

```text
Rep attempts to create "Acme Corp" (acme.com).
crm-hygiene check: search by domain acme.com.
Found: existing company "Acme Corporation" (ID: 11111), created 2025-03-01,
  3 contacts, 1 open deal, 12 activities.
Rep's new record would be: "Acme Corp", no associations yet.
Survivorship rule: existing record has more associations -> existing is survivor.
Action: do not create a new record. Use existing "Acme Corporation" (ID: 11111).
  Rep's new contact is associated to the existing company.
No merge write required — creation was blocked. crm-operator logs the dedup event.
```

**Full merge: two company records, different owners**

```text
Found: GlobalBank (ID: 22222, owner: Jordan) and Global Bank Inc (ID: 33333, owner: Dana).
  ID 22222: created 2024-11-01, 5 contacts, 2 deals, 40 activities.
  ID 33333: created 2025-01-15, 2 contacts, 0 deals, 8 activities.

Survivorship rule 1 (more associations): ID 22222 wins.
Survivor: GlobalBank (ID: 22222). Losing record: Global Bank Inc (ID: 33333).

Field conflicts:
  phone: 22222 has "+1 212 555 0100" vs 33333 has "+1 212 555 0199" -> keeping 22222 value.
    [33333 value noted in log for manual review.]
  industry: 22222 has "Financial Services" vs 33333 has "Banking" -> keeping 22222 value.

Associations from ID 33333 to re-associate:
  - Contact: Dana's champion (contact ID 44444) -> GlobalBank (ID 22222)
  - Activity: 8 call logs -> merged into GlobalBank timeline

Ownership conflict: ID 22222 owned by Jordan; ID 33333 owned by Dana.
  Post-merge ownership must be resolved via lead-routing.

REVIEW-PACK submitted. [Manager approves.]

crm-operator applies:
  1. Re-associate contact 44444 to ID 22222.
  2. Merge 8 activities into ID 22222 timeline.
  3. Resolve field conflicts per pack.
  4. Archive ID 33333 (not deleted). Log: archived ID 33333 merged into 22222.
  5. Read back ID 22222 — 7 contacts, 2 deals, 48 activities confirmed.
  6. Ownership conflict flagged to lead-routing for territory-rule resolution.
```

**Rejected merge: deal-quarter conflict**

```text
Found: two deal records for Initech — "Initech Q2 Expansion" (stage: Proposal,
  close: 2026-06-30) and "Initech New Logo" (stage: Discovery, close: 2026-09-30).
Survivorship check: different close-date quarters.
Rule: do not merge deals across different close-date quarters without explicit approval.
Output: these may be two genuinely separate opportunities (expansion and new logo).
  Flagging for rep and manager review — not merging without explicit approval.
  [If manager confirms they are the same deal: re-submit with manual override noted.]
```

## Anti-patterns

- **Merging without a review-pack and explicit approval.** Association-preservation
  and field conflict resolution require human review. A merge applied without
  approval has no audit trail and may silently drop associations or wrong-way
  keep a field value.
- **Deleting the losing record.** Archive it. A deleted record cannot be audited,
  recovered, or used to trace the merge history. `rules/lifecycle-stages.md`
  prohibits deletion as a cleanup action.
- **Merging contacts across companies without approval.** A contact at two
  companies is a relationship update, not a deduplication event. Auto-merging
  would incorrectly collapse two distinct associations.
- **Defining survivorship rules in another skill.** `lead-routing`, `pipeline-hygiene`,
  and `crm-hygiene` SKILL (when built) should cite this skill and defer. A competing
  rule set creates drift and inconsistent merge decisions.
- **Applying a merge to resolve an ownership conflict without addressing routing.**
  The merge determines the record; routing determines the owner. Both steps are
  required; neither substitutes for the other.
- **Treating a merge as a delete.** If the goal is to clean up a bad lead, the
  correct action is a disqualify/recycle status per `rules/lifecycle-stages.md`,
  not a merge. Merges are for genuine duplicates of the same real-world entity.
- **Bulk-merging without batching through the review-pack cap.** Bulk merges
  follow the same `ESCC_BULK_SEND_MAX` batch discipline as any bulk crm-operator
  write. Above the cap, split into approved batches.

## Related

- CRM data standards and dedupe-first policy: `rules/common/crm-hygiene.md`.
- Lifecycle status for disqualify/recycle (not delete): `rules/lifecycle-stages.md`.
- Merge and association-preservation writes: `crm-operator` (sole write path;
  review-pack required; explicit approval before apply).
- Ownership resolution after merge: `lead-routing`.
- Pre-creation search hook: `pre:crm-write-guard` (also checks stage exit criteria).
- Routing conflicts that surface duplicates: `lead-routing`.
- Governance capture for merge approval: `governance-capture`.
