---
description: Route a deal through deal-desk review — non-standard terms, approval tiers, and exception tracking.
argument-hint: "[deal | opportunity id | discount % | terms …]"
---

Apply the `deal-desk` skill to: $ARGUMENTS

Scope notes:
- For RevOps managing non-standard deal exceptions, discount approvals, and contract red-lines.
- Any CRM approval-status writes go through `crm-operator`; no contracts are sent to prospects.
- Output includes an approval routing recommendation and the required sign-off chain.
