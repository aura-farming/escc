# Routing Rules

Who owns a lead/account and how inbound and new records are assigned. Source of truth for the `lead-routing` skill and `/route`. Ownership in HubSpot is authoritative; this rule defines the policy HubSpot should reflect.

## Assignment model
- **Named accounts** route to their named owner regardless of source.
- **Territory** (geo / segment / vertical) routes to the territory owner; segment boundaries live in `rules/segments/*`.
- **Round-robin** fills only where no named-account or territory rule applies, balanced by capacity (`targets.md`).

## Inbound (speed-to-lead)
- Inbound MQLs are scored (`icp-profile` → `signal-scorer`) and routed within the response SLA. "Speed-to-lead-within-SLA" is a default behavior (seed instinct); `stop:sla-check` surfaces breaches.
- A lead that matches an existing open opportunity routes to that deal's owner, not round-robin.

## Reassignment & conflict
- Duplicate or conflicting ownership is resolved by `dedupe-merge` with survivorship; never silently steal ownership.
- Reassignments are logged with the prior owner and a reason (`crm-hygiene`).

## Disqualified / recycled
- Disqualified or recycled leads follow `rules/lifecycle-stages.md` (recycle reason + re-engage date), not silent deletion.
