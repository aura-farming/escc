---
description: Review your own open pipeline for hygiene issues — stale deals, missing MEDDPICC fields, and stage-age violations.
argument-hint: "[stage filter | date range …]"
---

Apply the `pipeline-hygiene` skill to: $ARGUMENTS

Scope notes:
- Self-scoped for any rep: runs pipeline-hygiene on the owner's own open deals only, not the full team.
- Read-only analysis; CRM field updates go through `crm-operator`.
- For team-wide pipeline hygiene, managers should use `/pipeline` instead.
