---
name: feature-development-with-docs-and-tests
description: Workflow command scaffold for feature-development-with-docs-and-tests in escc.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-docs-and-tests

Use this workflow when working on **feature-development-with-docs-and-tests** in `escc`.

## Goal

Implement a new feature, including code, documentation, and comprehensive tests.

## Common Files

- `scripts/escc.js`
- `scripts/lib/*.js`
- `skills/*/SKILL.md`
- `docs/DECISIONS.md`
- `docs/releases/*.md`
- `tests/unit/*.test.js`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement new or updated logic in scripts/lib/ and scripts/escc.js.
- Update or create related skills/*/SKILL.md files.
- Update or add documentation in docs/DECISIONS.md and docs/releases/vX.Y.Z.md.
- Add or update tests in tests/unit/ for new/changed logic.
- Update CHANGELOG.md with a summary of the feature.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.