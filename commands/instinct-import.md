---
description: Import shared team instincts into the current workspace.
argument-hint: "[file path | URL | workspace]"
---

Apply the `instincts` skill to: $ARGUMENTS

Scope notes:
- Validates the bundle schema before importing; malformed entries are skipped with a report.
- Imported instincts land in pending status and require `/instinct-status` review before activation.
- Duplicate detection runs on import; conflicts surface for manual resolution.
