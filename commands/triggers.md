---
description: Detect buying and timing triggers for an account and map each to an outreach play.
argument-hint: "[account | company | domain | trigger type]"
---

Apply the `trigger-detection` skill to: $ARGUMENTS

Scope notes:
- Scans for buying signals (funding, hiring, product launches, leadership changes, intent data).
- Maps each detected trigger to a recommended play with urgency rating and suggested channel.
- Output is a prioritized trigger list ready to feed into `cold-outreach`, `follow-up-ops`, or `multi-threading` for play execution.
