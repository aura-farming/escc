---
description: Triage the email inbox — classify into action tiers and draft replies with account context.
argument-hint: "[thread | sender | label | date range]"
---

Apply the `inbox-triage` skill to: $ARGUMENTS

Scope notes:
- Classifies each thread into one of six named classes in priority order: skip / info_only / meeting_info / deal_action / action_required / opt_out_request.
- Drafts are enriched with account and deal context from CRM; sends go through the outbound send-gate.
- Gmail is draft-only by construction; no live sends without explicit approval.
