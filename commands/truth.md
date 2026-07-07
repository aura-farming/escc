---
description: THE reconciled account picture — live CRM vs memory vs ledgers, every section labeled source + last-verified; drift routes to escc reconcile.
argument-hint: "<account name | domain | company:id>"
---

Apply the `account-truth` skill to: $ARGUMENTS

Scope notes:
- Resolve the canonical identity FIRST (`escc identity resolve`; link name-tier ids) so every store joins.
- Read-only: presents labeled truth; fixes route to `crm-operator` / `escc reconcile --apply` / `escc identity link`.
- Never quotes product claims — those come from `escc product retrieve` (ADR-0012).
