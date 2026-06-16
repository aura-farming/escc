---
description: Build an SDR-to-AE or AE-to-CS handoff with completeness checks.
argument-hint: "[account | deal | handoff type]"
---

Apply the `sales-handoffs` skill to: $ARGUMENTS

Scope notes:
- Supports SDR→AE and AE→CS handoff types; specify or the skill prompts for it.
- Runs completeness checks against required MEDDPICC fields before generating the handoff doc.
- CRM field updates required to close gaps go through `crm-operator`.
