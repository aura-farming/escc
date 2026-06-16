---
description: Run the SDR prospecting pipeline — research → ICP-score → warm-path → draft first-touch, all draft-only.
argument-hint: "[account | account list | ICP segment]"
---

Apply the `prospecting-pipeline` skill to: $ARGUMENTS

Scope notes:
- Orchestrates the `account-researcher`, `signal-scorer`, `warm-path-mapper`, and `outreach-drafter` agents; pulls proof from `product-knowledge` and voice from `brand-voice`.
- Output is **draft-only** — nothing sends until `outbound-reviewer` and the fail-closed send gate clear it.
- Reuse `account-memory` for known accounts; don't re-research what's already on record.
