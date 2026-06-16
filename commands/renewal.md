---
description: Run a renewal health check — risk triage, retention play, and expansion whitespace analysis.
argument-hint: "[account | renewal date | ARR …]"
---

Apply the `renewal-playbook` skill to: $ARGUMENTS

Scope notes:
- Renewal is treated as a full deal: MEDDPICC-aware scoring, not a lightweight check-in.
- Expansion and whitespace identification draws from `product-knowledge` and account history in HubSpot.
- Risk triage surfaces churn signals; remediation actions require rep judgment and manager alignment before execution.
