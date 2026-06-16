---
name: feature-development-with-schema-and-tests
description: Workflow command scaffold for feature-development-with-schema-and-tests in escc.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-schema-and-tests

Use this workflow when working on **feature-development-with-schema-and-tests** in `escc`.

## Goal

Implements a new core feature including schema definition, data layer/store, and corresponding unit tests.

## Common Files

- `schemas/*.schema.json`
- `scripts/instincts/*.js`
- `tests/unit/*.test.js`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Define or update a JSON schema in schemas/*.schema.json
- Implement or update the data store/engine logic in scripts/instincts/*.js
- Write or update unit tests in tests/unit/*.test.js

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.