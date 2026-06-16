---
description: Retrieve or update approved product knowledge — value props, use-cases, proof points, and claims — with provenance.
argument-hint: "[query | add <value-prop|use-case|proof-point|claim> …]"
---

Apply the `product-knowledge` skill to: $ARGUMENTS

Scope notes:
- Retrieval is the default: return the matching approved entry **with its provenance**, or say plainly when no approved proof exists — never invent a metric or customer reference.
- Adds are provenance-first and default to `approved: false` until a human clears them; honor each entry's channel guardrail.
- This is the company-level "what we sell" layer — per-account facts go through `account-memory`, live wording through the drafting skills.
