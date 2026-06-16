---
description: Run CPQ math — discount tiers, packaging, ramp structures, and approval routing.
argument-hint: "[deal | ACV | tier | discount % | ramp …]"
---

Apply the `quote-desk` skill to: $ARGUMENTS

Scope notes:
- This is the sole pricing-math owner; all other skills defer here for CPQ line items and discount figures.
- Discount approval routing follows `rules/approval-matrix.md`; quotes outside approval thresholds are blocked pending sign-off.
- Output is a quote draft — no quote is sent to a prospect without the required approvals recorded.
