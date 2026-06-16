---
description: Identify and resolve duplicate CRM records — contacts, companies, or deals — with a merge recommendation.
argument-hint: "[record id | company name | email | duplicate pair …]"
---

Apply the `dedupe-merge` skill to: $ARGUMENTS

Scope notes:
- For RevOps cleaning duplicate contacts, accounts, or opportunities in the CRM.
- All merges and deletes go through `crm-operator`; no records are modified without approval.
- Output is a merge plan with a confidence score and the fields that would change.
