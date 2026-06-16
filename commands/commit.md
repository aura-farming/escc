---
description: Prepare your own commit and best-case forecast call for the current period.
argument-hint: "[period | deals to include | confidence notes …]"
---

Apply the `forecast-rollup` skill to: $ARGUMENTS

Scope notes:
- Self-scoped for any rep: rolls up the owner's own deals into a commit/best-case call, not the full team.
- Read-only aggregation; forecast submission to CRM goes through `crm-operator`.
- For team rollup, managers should use `/forecast` instead.
