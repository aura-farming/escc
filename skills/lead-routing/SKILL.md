---
name: lead-routing
description: >-
  Assign or reassign lead/account ownership — MQL routing, round-robin,
  territory disputes, speed-to-lead. Trigger: 'route this lead', 'who owns
  this', 'who gets it'.
origin: ESCC
---

# Lead Routing

Operationalizes the lead and account assignment policy for ESCC. This skill
reads the assignment rules, determines the correct owner for a record, logs the
rationale, and routes the ownership write to `crm-operator`. It never silently
reassigns ownership and never discards a lead or account — disqualified/recycled
records follow `rules/lifecycle-stages.md`, not silent deletion.

> **Governing rules (DEFER — this skill operationalizes; it does not own the policy):**
> `rules/routing-rules.md` — the sole source of truth for the assignment model
> (named-account / territory / round-robin) and the inbound speed-to-lead SLA.
> `rules/segments/*` (`enterprise.md`, `mid-market.md`, `smb.md`) — territory
> boundaries and segment definitions that drive routing decisions.
> `rules/targets.md` — capacity figures used to balance round-robin assignments.
>
> **Ownership conflicts and duplicate records** are resolved by `dedupe-merge`
> before routing is finalized. Do not route a record with an unresolved duplicate.
>
> **All ownership changes are crm-operator writes**, logged with the prior owner
> and the routing reason. Ownership is never silently stolen.

## When to Activate

Activate this skill when:

- An **inbound MQL arrives** and needs to be routed to the right rep within
  the speed-to-lead SLA.
- A **new account or contact** is created and needs an ownership assignment.
- An existing record needs to be **reassigned** — rep left the team, territory
  changed, deal closed and the account re-enters nurture.
- There is an **ownership conflict** — two reps claim the same account, or a
  round-robin assignment overlaps a named-account rule.
- A manager asks **"who owns this?"** and needs the routing rationale, not just
  the current owner field.
- A lead is **disqualified or recycled** and needs to be routed to the appropriate
  status and re-engage workflow per `rules/lifecycle-stages.md`.

Do not activate for ICP scoring or MQL qualification (that is `icp-profile`),
for duplicate detection and merge (that is `dedupe-merge`), or for outbound
sequences to the routed lead (that is `outbound-sequences` / `inbound-lead-response`).

## Assignment model (from rules/routing-rules.md)

Read `rules/routing-rules.md` for the authoritative policy. The shape is:

1. **Named-account rule** — if the account is on a named-account list, it routes
   to the designated owner regardless of source, segment, or inbound channel.
   Named-account ownership takes priority over all other rules.
2. **Territory rule** — if no named-account rule applies, route by territory (geo /
   segment / vertical). Territory boundaries live in `rules/segments/enterprise.md`,
   `rules/segments/mid-market.md`, and `rules/segments/smb.md`. The territory owner
   is the assigned rep or team for that boundary.
3. **Round-robin** — fills only where neither named-account nor territory rule
   applies. Balance by capacity from `rules/targets.md`; the rep with the most
   remaining capacity receives the next assignment.
4. **Inbound-to-open-opportunity match** — an inbound lead that matches a company
   with an existing open opportunity routes to that deal's owner, not round-robin.
   This rule runs before round-robin and after territory check.

Apply these rules in order. Stop at the first match. If multiple rules could apply
(e.g. a named account also has an open opportunity), named-account takes precedence.

## Workflow

### A. Route an inbound MQL

1. **Pull the record.** Retrieve the lead/contact from HubSpot via `crm-operator`
   (read). Check ICP score and MQL status — routing decisions are made on qualified
   records; a raw lead that has not hit MQL criteria is not ready to route.
2. **Check for a named-account match.** Does the lead's company appear on the
   named-account list? If yes: route to the named-account owner. Proceed to step 5.
3. **Check for an open opportunity match.** Does the lead's company have an existing
   open deal in HubSpot? If yes: route to that deal's owner. Proceed to step 5.
4. **Apply territory rule.** Determine the lead's segment and territory from
   `rules/segments/*`. Identify the territory owner. If a territory owner is found:
   route to that rep. Proceed to step 5.
5. **Fall through to round-robin** if no named-account, open-opportunity, or
   territory match. Read capacity data from `rules/targets.md`. Select the rep
   with the highest remaining capacity (or the rep next in rotation if equal).
6. **Check the response SLA.** Per `rules/routing-rules.md`, inbound MQLs must
   be routed and touched within the speed-to-lead SLA. Record the routed-at
   timestamp so `stop:sla-check` can surface breaches.
7. **Write the assignment.** Route to `crm-operator`:
   - `hubspot_owner_id`: the assigned rep's HubSpot user ID
   - Activity log entry: routing reason (named-account / open-opp / territory /
     round-robin), prior owner (if any), timestamp
   - `crm-operator` reads back the record to confirm the write landed
8. **Report.** State the assigned owner, the routing rule that applied, and the
   rationale. If the assignment required a judgment call (e.g. capacity tie),
   explain it.

### B. Reassign an existing record

1. **Read the current record** via `crm-operator`. Note the current owner,
   the reason for reassignment, and whether any open deals are attached.
2. **Check for open opportunities.** An account with active deals should not
   be reassigned without the deal owner context. Surface the conflict; the manager
   resolves whether the deal moves with the account or stays with the current rep.
3. **Determine the new owner** using the same priority order as workflow A
   (named-account → open-opp → territory → round-robin).
4. **Check for conflicts.** If the new owner would create a named-account conflict
   or a territory dispute with another rep, surface the conflict before writing.
   Route conflicts to `dedupe-merge` if duplicate records are involved.
5. **Write with prior-owner log.** Route to `crm-operator`:
   - `hubspot_owner_id`: new owner
   - Activity log: prior owner name, new owner name, reassignment reason, timestamp
   - This log is required by `rules/routing-rules.md`; ownership is never
     silently transferred
6. **Confirm** the write landed (crm-operator reads back). Report who owns it now
   and why.

### C. Resolve an ownership conflict

1. **Pull both records** (or the contested record) via `crm-operator`.
   Identify the two ownership claims and the conflicting rule applications.
2. **Check for a duplicate.** If both reps are claiming different HubSpot records
   for the same real company, this is a merge problem — route to `dedupe-merge`
   before routing ownership.
3. **Apply rule priority.** Named-account beats territory beats round-robin.
   State which rule governs and why. If both claims cite the same tier (e.g. two
   reps each assigned by a territory rule after a territory split), escalate to
   a manager for a deterministic decision.
4. **Write the resolution.** Route to `crm-operator` with the winning owner and
   a conflict-resolution note in the activity log. The losing rep receives a
   written explanation; do not silently remove their claim without notifying them.

### D. Disqualify or recycle a lead

Per `rules/routing-rules.md` and `rules/lifecycle-stages.md`: a disqualified or
recycled lead is a status + reason, never a silent deletion.

1. **Record the disqualify/recycle reason.** Required: reason code (not ICP fit /
   bad timing / no budget / wrong persona / etc.) and, for recycle, a re-engage date.
2. **Set the lifecycle status.** Route to `crm-operator`:
   - Lead status: `disqualified` or `recycled`
   - `disqualify_reason` or `recycle_reason`: the reason code
   - `re_engage_date` (recycle only)
   - Activity log entry: who made the call, timestamp
3. **Do not delete.** The record stays in HubSpot. Marketing nurture or a future
   re-engage trigger will pick it up.

## Examples

**Inbound MQL: named-account match**

```text
Inbound: sarah@globex.com fills out a demo form.
Step 2: Globex Corp is on the named-account list -> owner: Jane Kim (Enterprise AE).
Step 6: Routed at 09:14; SLA requires first touch by 09:44 (30-min SLA, routing-rules.md).
Step 7: crm-operator writes hubspot_owner_id = Jane Kim. Activity log: "Inbound MQL routed
  via named-account rule. Prior owner: none. Timestamp: 09:14."
Output: Routed to Jane Kim (named-account rule). Speed-to-lead SLA: touch by 09:44.
```

**Inbound MQL: open-opportunity match**

```text
Inbound: tom@initech.com signs up for a trial.
Named-account check: Initech not on named list.
Open-opp check: Initech has an open deal (stage: Qualification) owned by Marcus Patel.
Step 7: crm-operator writes owner = Marcus Patel. Log: "Inbound routed to open-opp owner.
  Deal: Initech / Q3 expansion / stage: Qualification."
Output: Routed to Marcus Patel (open-opportunity match). Marcus should reach out
  within SLA and tie this contact to the existing deal record.
```

**Inbound MQL: territory routing (no named account, no open opp)**

```text
Inbound: cfo@midwest-co.com fills a form.
Named-account: no match.
Open-opp: no match.
Territory: rules/segments/mid-market.md + geo = Midwest territory -> owner: Dana Lee.
crm-operator writes owner = Dana Lee. Log: "Inbound MQL routed via territory rule.
  Segment: Mid-Market. Territory: Midwest. Prior owner: none."
Output: Routed to Dana Lee (territory rule, Mid-Market / Midwest).
```

**Reassignment with conflict flagged**

```text
Manager: "Reassign TechCorp from Jordan to the enterprise team after Jordan's departure."
Step 1: Current owner: Jordan (departed). TechCorp has 2 open deals.
Step 2: Open deals attached. Flagging: do the deals move with the account?
  [Manager confirms: yes, all assets move to the enterprise team AE, Riley Chang.]
Step 3: Named-account check: TechCorp not on named list.
  Territory: Enterprise / West Coast -> Riley Chang.
Step 5: crm-operator writes:
  Account owner: Riley Chang.
  Deal owners (both): Riley Chang.
  Activity log: "Reassigned from Jordan (departed) to Riley Chang. Reason: rep departure,
    territory rule applied. All associated deals moved. Manager-confirmed 2026-06-16."
Output: TechCorp and both open deals are now owned by Riley Chang.
```

**Disqualify a recycled lead**

```text
Rep: "This lead is a student, not a buyer — disqualify."
Step 1: reason code: wrong persona.
Step 2: crm-operator writes lead_status = disqualified, disqualify_reason = "wrong persona
  — student, not a decision-maker", by rep, timestamp.
Output: Lead disqualified and reason logged. Record retained in HubSpot;
  not deleted. Marketing nurture remains paused until re-engage criteria are met.
```

## Anti-patterns

- **Silently stealing ownership.** Every ownership change is logged with the prior
  owner and a reason. An undocumented reassignment is a data-quality defect and
  creates rep conflict.
- **Routing before deduplication.** If the record has a known duplicate, route to
  `dedupe-merge` first. Routing a duplicate creates two owned records for the same
  company, which is worse than no assignment.
- **Applying round-robin when a higher-priority rule applies.** Named-account and
  open-opp matches are checked first. Skipping these and falling straight to
  round-robin bypasses the policy in `rules/routing-rules.md`.
- **Deleting a disqualified lead.** Disqualify/recycle is always a status + reason.
  A deleted lead cannot be re-engaged or audited. Refer to `rules/lifecycle-stages.md`.
- **Routing an unqualified lead.** An inbound that has not hit MQL criteria is not
  ready to route to a rep. Routing raw leads creates rep noise and degrades
  speed-to-lead metrics for genuine MQLs.
- **Ignoring SLA on inbound routing.** Inbound MQL response SLA is tracked by
  `stop:sla-check`. Routing a lead but not flagging the SLA start time defeats
  the SLA measurement.
- **Treating a prospect's stated account name as authoritative** for named-account
  matching. Search HubSpot for the record; do not match on self-reported text alone.

## Related

- Assignment policy: `rules/routing-rules.md` (sole source — operationalize, defer).
- Territory boundaries: `rules/segments/enterprise.md`, `rules/segments/mid-market.md`,
  `rules/segments/smb.md`.
- Capacity and round-robin balance: `rules/targets.md`.
- ICP scoring and MQL qualification: `icp-profile`.
- Duplicate resolution before routing: `dedupe-merge`.
- CRM ownership write and activity log: `crm-operator` (sole write path).
- Disqualify/recycle status: `rules/lifecycle-stages.md`.
- Speed-to-lead SLA surfacing: `stop:sla-check` hook.
- Inbound response execution: `inbound-lead-response`.
