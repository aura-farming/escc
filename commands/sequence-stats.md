---
description: Analyze sequence/variant conversion (open → reply → meeting), compare A/B, recommend promote/retire.
argument-hint: "[sequence | variant | date range]"
---

Apply the `outreach-analytics` skill to: $ARGUMENTS

Scope notes:
- Read-only analysis — no sends; metric definitions stay consistent with `rules/common/forecasting-definitions.md`.
- Recommends which step/variant to **promote or retire**; promotes winners back into `playbook-library`.
- Feeds `outbound-sequences` so the next cadence uses the best-performing variants.
