---
description: Build a compliant multi-touch outbound cadence (email/LinkedIn/call/voicemail) — all steps draft-only.
argument-hint: "[persona/segment | account | campaign]"
---

Apply the `outbound-sequences` skill to: $ARGUMENTS

Scope notes:
- Every email step carries a functional unsubscribe + accurate sender identity; suppression/DNC check **before** enrollment.
- Steps pull structure from `playbook-library`, proof from `product-knowledge`, voice from `brand-voice`.
- All steps are **draft-only** — `outbound-reviewer` and the fail-closed send gate gate any send; bulk sends are capped.
