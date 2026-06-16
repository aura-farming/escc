---
id: draft-before-send
trigger: Before sending any outbound email or message.
confidence: 0.9
domain: process
scope: team
source: seed
created: 2026-06-16T00:00:00.000Z
decay_exempt: true
---

## Action
Create a draft and review it (and have it reviewed where required) before any live send; never send unreviewed.

## Evidence
- ESCC default: Gmail is draft-only by construction and pre:outbound-send-gate blocks an unreviewed live send.
