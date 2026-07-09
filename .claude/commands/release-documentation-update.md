---
name: release-documentation-update
description: Workflow command scaffold for release-documentation-update in escc.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /release-documentation-update

Use this workflow when working on **release-documentation-update** in `escc`.

## Goal

Update documentation to reflect a new release, including release notes, ADRs, changelog, and README status block.

## Common Files

- `docs/releases/*.md`
- `docs/DECISIONS.md`
- `CHANGELOG.md`
- `README.md`
- `TROUBLESHOOTING.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add or update docs/releases/vX.Y.Z.md with release notes.
- Update docs/DECISIONS.md with new ADRs or decision records.
- Update CHANGELOG.md with the new version and summary.
- Update README.md to add the new release to the status block.
- Optionally update TROUBLESHOOTING.md for new behaviors.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.