# ESCC Hooks

`hooks/hooks.json` is the production Claude Code hook graph for ESCC. It is validated by
`schemas/hooks.schema.json` (via `scripts/ci/validate-hooks.js`).

## Routing

Every command routes through the dispatch runner using the plugin root Claude Code supplies natively:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js <hookId> scripts/hooks/<file>.js <profilesCsv>
```

`SessionStart` is the one exception: it invokes `scripts/hooks/session-start-bootstrap.js`, a thin
fallback resolver that locates the plugin root (the env var is not guaranteed at SessionStart) and
then delegates to `run-with-flags.js` for `session:start`. There is **no inline `node -e` bootstrap
resolver** — ESCC relies on `${CLAUDE_PLUGIN_ROOT}`.

`run-with-flags.js` applies profile gating (`scripts/lib/hook-flags.js`), enforces the configurable
stdin cap (`ESCC_HOOK_INPUT_MAX_BYTES`, default 1 MiB), rejects path traversal, and prefers a
direct `require()` of hooks that export `run(raw, ctx)` (falling back to a child-process spawn for
legacy hooks).

## Failure policy

**Every hook fails open except `pre:outbound-send-gate`, which fails CLOSED.** A failing hook must
never block legitimate work — on any doubt the runner emits exit 0 and never echoes a truncated
payload. The send gate inverts this: on any doubt it blocks the send (exit 2).

A hook signals a block by returning `{ exitCode: 2, stderr: '<reason>' }` from `run()`. Returning
`undefined` (or a plain string) passes the tool call through. `{ additionalContext: '<text>' }`
injects context without blocking.

## Profiles

`ESCC_HOOK_PROFILE` ∈ `minimal | standard | strict` (default `standard`). The profile CSV in each
command line lists the profiles under which that hook runs. `ESCC_DISABLED_HOOKS=<id,id>` force-disables
specific hooks regardless of profile.

| Profile | Hooks active |
|---|---|
| `minimal` | safety/lifecycle only: outbound-send-gate, compliance-protection, attachment-quarantine, observe, metrics-bridge, context-monitor, session-activity-tracker, evaluate-session, cost-tracker, session lifecycle, pre-compact |
| `standard` (default) | all of `minimal` + crm-write-guard, mcp-health-check, bash dispatcher, suggest-compact, governance-capture, crm-log-reminder, outbound-style-check, deliverables-location, follow-through-check, sla-check, desktop-notify |
| `strict` | all of `standard` with blocking escalations (e.g. crm-write-guard blocks stage-advance without exit criteria; outbound-style-check via `ESCC_QUALITY_GATE_STRICT`) |

## Hook inventory

See `hooks/hooks.json` for the authoritative list. Security-critical hooks: `pre:outbound-send-gate`
(fail-closed), `pre:crm-write-guard`, `pre:compliance-protection`, `pre:attachment-quarantine`,
`pre:bash:dispatcher`. The memory-persistence subset is documented in `hooks/memory-persistence/`.

## Related

- `scripts/hooks/run-with-flags.js` — the dispatch runner
- `scripts/lib/hook-flags.js` — profile gating
- `config/outbound-tools.json` — send-capable tool deny/allow patterns (read by the send gate)
- `docs/HOOKS.md` — longform hook documentation
