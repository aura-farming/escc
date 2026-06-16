---
description: Audit CRM activity data — call and email volumes, meeting rates, and sequence adherence by rep or team.
argument-hint: "[rep | team | period | activity type …]"
---

Apply the `activity-audit` skill to: $ARGUMENTS

Scope notes:
- For RevOps identifying activity gaps, data-quality issues, and adherence to engagement standards.
- Read-only audit; CRM data corrections go through `crm-operator`.
- Output flags reps or segments below activity benchmarks with a severity ranking.
