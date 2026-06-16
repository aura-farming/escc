---
description: Apply lead-routing logic to assign or re-assign inbound leads by territory, segment, and capacity rules.
argument-hint: "[lead id | company | segment | region …]"
---

Apply the `lead-routing` skill to: $ARGUMENTS

Scope notes:
- For RevOps running or auditing lead-routing logic and assignment rules.
- CRM ownership changes go through `crm-operator`; routing output is a recommendation until applied.
- Output includes the recommended owner, routing rationale, and any rule conflicts flagged.
