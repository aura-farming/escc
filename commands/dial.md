---
description: Prep a call block, work openers/gatekeeper/voicemail scripts, and log a disposition after every dial.
argument-hint: "[call list / account]"
---

Apply the `cold-calling` skill to: $ARGUMENTS

Scope notes:
- Openers, gatekeeper lines, and voicemail scripts come from `playbook-library`.
- Capture a disposition after **every** dial and log it to HubSpot via `crm-operator` (never claim a logged call without a tool-result).
- This drives live call activity — pair with `/book` to convert connects into meetings.
