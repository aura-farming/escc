# Memory Persistence Hooks

These lifecycle hook definitions document ESCC's memory-persistence contract — the surface that lets
the harness hold account context across MONTHS and many sessions (Pillar 3, spec §6.2 + A.2).

The executable implementations live in `scripts/hooks/`:

- `session-start-bootstrap.js` → `session-start.js` — hydrate the ACTIVE deal's account memory plus
  open loops, due follow-ups, and high-confidence instincts (priority-budgeted, capped by
  `ESCC_SESSION_START_MAX_CHARS`).
- `pre-compact.js` — persist task intent, active account/deal, un-applied findings, and pending
  actions to a resumable scratch file before compaction.
- `session-end.js` — transcript JSONL → markdown summary AND append tagged events to the active
  account/deal memory file (account memory is the canonical per-entity store, not the session summary).
- `observe-runner.js` — record tool-use observations for continuous learning (untrusted tool output
  tagged, never used to form instincts).
- `session-activity-tracker.js` — record per-session tool calls, accounts touched, and file activity.

The installed hook graph is `hooks/hooks.json`. This directory is the stable, human-readable
lifecycle definition surface referenced by the harness audit and longform docs.

## Lifecycle Contract

| Event | Hook | Purpose | Blocking |
|---|---|---|---|
| `SessionStart` | `session:start` | Hydrate active-deal memory + open loops + instincts (priority-budgeted) | no |
| `PreCompact` | `pre:compact` | Save resumable working state before compaction | no |
| `PreToolUse` | `pre:observe` | Capture tool intent for learning signals | no |
| `PostToolUse` | `post:observe` | Capture tool result for learning signals | no |
| `PostToolUse` | `post:session-activity-tracker` | Record tool/file/account activity | no |
| `Stop` | `stop:follow-through-check` | Surface unsent drafts, unlogged promises, missing next steps | no (warn) |
| `Stop` | `stop:evaluate-session` | Session-outcome learning signal | no |
| `SessionEnd` | `session:end` | Persist summary + append to account memory | no |
| `SessionEnd` | `session:end:marker` | Finalize activity metrics | no |

## Long-Horizon Context (A.2)

- **Account memory is canonical.** `session:end` APPENDS tagged events to the active account/deal
  memory file; `session:start` hydrates the active deal's memory, not just last session's summary.
- **Open loops/promises/near-close deals are decoupled from the 7-day gate** — they surface until
  resolved (within retention), even after a long gap. A "welcome back" digest follows a gap.
- **Promises are first-class state-store records** (`promises` table) recalled per-account.

## Operator Expectations

- Keep persistence local by default. Data root `$ESCC_AGENT_DATA_HOME` (default `~/.claude`).
- Avoid sending transcripts or tool traces to hosted services unless a user explicitly enables an integration.
- Bound context loaded at session start with `ESCC_SESSION_START_MAX_CHARS` (8000).
- Allow opt-out with `ESCC_SESSION_START_CONTEXT=off`.
- Durable-store retention: `ESCC_MEMORY_RETENTION_DAYS`, `ESCC_OBSERVATION_RETENTION_DAYS`,
  `ESCC_SESSION_RETENTION_DAYS` (30; 0/off = keep all).
- Keep lifecycle hooks profile-gated through `ESCC_HOOK_PROFILE` and `ESCC_DISABLED_HOOKS`.
- Prospect-supplied content never auto-forms instincts; review surface is `/instinct-status`.

## Related Files

- `hooks/hooks.json`
- `hooks/README.md`
- `scripts/hooks/session-start.js`, `pre-compact.js`, `session-end.js`, `observe-runner.js`, `session-activity-tracker.js`
- `scripts/lib/state-store/` (promises, outcomes, forecast_snapshots)
- `docs/INSTINCTS.md`, `docs/ARCHITECTURE.md`
