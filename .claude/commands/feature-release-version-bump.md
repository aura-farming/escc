---
name: feature-release-version-bump
description: Workflow command scaffold for feature-release-version-bump in escc.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-release-version-bump

Use this workflow when working on **feature-release-version-bump** in `escc`.

## Goal

Finalize and bump the version for a new feature release, updating all relevant version and changelog files.

## Common Files

- `package.json`
- `package-lock.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `CLAUDE.md`
- `CHANGELOG.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update package.json and package-lock.json with the new version.
- Update .claude-plugin/plugin.json and .claude-plugin/marketplace.json with the new version.
- Update CLAUDE.md with the new version line.
- Update CHANGELOG.md with the release date and details.
- Optionally update SOUL.md, AGENTS.md, agent.yaml, or other meta files.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.