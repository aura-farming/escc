---
description: Scan the team pipeline for hygiene issues — stale deals, missing MEDDPICC fields, and stage-age violations.
argument-hint: "[team | rep | date range | stage filter …]"
---

Apply the `pipeline-hygiene` skill to: $ARGUMENTS

Scope notes:
- For sales managers auditing their team's open pipeline; not scoped to a single rep unless named.
- Read-only analysis; any CRM field updates go through `crm-operator`.
- Outputs a prioritized list of hygiene issues with recommended owner actions.
