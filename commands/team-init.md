---
description: Detect the team GTM stack and write a workspace CLAUDE.md for ESCC.
argument-hint: "[workspace path | team name]"
---

Apply the `team-init` skill to: $ARGUMENTS

Scope notes:
- Probes the environment for CRM, sequencer, inbox, and calendar connections before writing config.
- Writes a workspace CLAUDE.md scoped to the detected stack; does not overwrite an existing one without confirmation.
- Run once per workspace; re-run when the GTM stack changes.
