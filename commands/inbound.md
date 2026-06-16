---
description: Triage and respond to an inbound lead within its speed-to-lead SLA — ICP-score, route, draft the response.
argument-hint: "<lead / form fill / inbound email>"
---

Apply the `inbound-lead-response` skill to: $ARGUMENTS

Scope notes:
- ICP-score via the `signal-scorer` agent; apply the tier-based response SLA (Hot ≤5 min, Warm ≤1 hr, Low ≤same day).
- Route ownership via `lead-routing`; SQL/SAL accept-reject per `rules/lifecycle-stages.md`.
- The response is **draft-only**; the CRM log/owner change goes through `crm-operator`.
