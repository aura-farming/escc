---
description: Generate a deal-specific proposal using account context and approved product knowledge.
argument-hint: "[deal | contact | use-case | packaging tier …]"
---

Apply the `proposal-builder` skill to: $ARGUMENTS

Scope notes:
- All claims and proof points come from `product-knowledge`; unverified metrics are never inserted.
- Pricing figures and discount approval defer to `quote-desk` — this skill builds the narrative, not the CPQ line items.
- Output is a draft; no proposal goes to a prospect without rep review and approval.
