---
id: no-bulk-without-review-pack
trigger: Before any bulk send or bulk CRM operation.
confidence: 0.85
domain: process
scope: team
source: seed
created: 2026-06-16T00:00:00.000Z
decay_exempt: true
---

## Action
Produce a review pack and get approval before any bulk action; respect ESCC_BULK_SEND_MAX.

## Evidence
- security/approval gates: bulk operations require human approval at the hook boundary.
