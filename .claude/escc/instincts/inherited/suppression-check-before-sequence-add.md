---
id: suppression-check-before-sequence-add
trigger: Before adding any contact to a sequence.
confidence: 0.9
domain: outreach
scope: team
source: seed
created: 2026-06-16T00:00:00.000Z
decay_exempt: true
---

## Action
Screen against the suppression list (opt-outs, DNC, bounces, complaints, legal holds) first; never contact a suppressed record.

## Evidence
- outbound-compliance: suppression is global and always wins.
