---
description: Export approved instincts for team sharing or backup.
argument-hint: "[workspace | tag | output path]"
---

Apply the `instincts` skill to: $ARGUMENTS

Scope notes:
- Exports only approved instincts; pending and rejected entries are excluded by default.
- Output is a portable JSONL bundle suitable for `/instinct-import` on another workspace.
- Strip any PII or prospect-identifying content before sharing across team boundaries.
