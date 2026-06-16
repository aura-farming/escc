---
id: send-monday-mornings-for-this-segment
trigger: When scheduling first-touch outbound to mid-market ops leaders.
confidence: 0.72
domain: outreach
scope: personal
source: distilled
applies_to: mid-market
workspace_id: 9f1c2a7b3e4d
workspace_name: you@acme.example
created: 2026-05-02T09:14:00.000Z
last_observed: 2026-06-14T17:30:00.000Z
decay_exempt: false
---

## Action
First touches to mid-market ops leaders get more replies when sent Monday/Tuesday morning; schedule sends in that window rather than late Friday.

## Evidence
- 6 of 8 replies in this segment over the last quarter came from Mon/Tue AM sends (outcome: reply_received).
- Confidence rose from 0.6 → 0.72 on the last two confirmations; will decay if it stops being confirmed.

<!-- Example of a LEARNED personal instinct (what /instinct-status shows). Unlike the
     shipped team seeds, a learned instinct is segment-scoped (applies_to), workspace-keyed,
     outcome-weighted (I2), and subject to decay (I4). Personal -> team is manager-gated (I5). -->
