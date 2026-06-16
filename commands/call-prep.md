---
description: Build a pre-meeting brief — attendees, roles, account and deal history, and MEDDPICC gaps to probe.
argument-hint: "[contact | deal | company | meeting date …]"
---

Apply the `call-prep` skill to: $ARGUMENTS

Scope notes:
- Account and deal history is pulled HubSpot-first; cite `deal-review` for the current MEDDPICC scoring before the call.
- Surfaces the open MEDDPICC gaps most worth probing in this specific meeting — no gaps are invented.
- Output is a read-only brief; any CRM updates after the call go through `discovery-notes`.
