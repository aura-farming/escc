---
name: cli-surface-and-subcommand-extension
description: Workflow command scaffold for cli-surface-and-subcommand-extension in escc.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /cli-surface-and-subcommand-extension

Use this workflow when working on **cli-surface-and-subcommand-extension** in `escc`.

## Goal

Adds or extends CLI functionality, including new subcommands, supporting libraries, and corresponding tests.

## Common Files

- `scripts/escc.js`
- `scripts/lib/*.js`
- `scripts/*.js`
- `schemas/*.schema.json`
- `tests/unit/*.test.js`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement or update CLI entrypoint in scripts/escc.js or similar
- Add supporting logic in scripts/lib/*.js or scripts/*.js
- Update or add relevant JSON schemas in schemas/*.schema.json if needed
- Write or update unit tests in tests/unit/*.test.js

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.