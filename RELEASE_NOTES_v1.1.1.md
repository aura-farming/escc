# ESCC v1.1.1 — runtime hardening: the send-gate can never silently fail open

**A bare plugin install now works without `node_modules`, and the fail-closed
outbound send-gate is provably un-bypassable.**

## Why

ESCC's sole dependency is `ajv`. A Claude Code **plugin/marketplace install does
not run `npm install`**, so `node_modules` (hence `ajv`) is absent at runtime.
A top-level `require('ajv')` in the state-store and instinct validators then threw
`MODULE_NOT_FOUND` — and because nearly every hook and the `escc` CLI load the
state store, the whole state-backed machinery (persistence, promises, instincts,
governance, the `escc outbound approve` token store) was dead in a real install.

Worst of all, the one **fail-closed** hook inverted: with `ajv` missing,
`pre:outbound-send-gate` crashed on load → the dispatcher fell back to a legacy
spawn → the child also crashed → exit 1, which `PreToolUse` does not treat as a
block. **The gate that exists to stop unreviewed outbound was failing OPEN.**

## What's fixed

- **`ajv` is optional at runtime.** The two runtime validators
  (`state-store/schema.js`, `instincts/instinct-store.js`) load `ajv` in a guarded
  `try/catch` and skip schema validation gracefully when it is absent — they never
  crash. With `ajv` present (dev/CI, npm-installed checkouts) the schema is still
  fully enforced; the CI-only validators are unchanged.
- **The send-gate can never silently fail open.** The dispatcher
  (`run-with-flags.js`) now **blocks (exit 2)** whenever the fail-closed gate
  cannot run to a verdict — module-load failure, a `run()` throw, a legacy-child
  crash, a missing script, or a rejected path.
- **The send-gate is non-disableable.** `ESCC_DISABLED_HOOKS` and hook profiles
  can no longer switch it off (`hook-flags.js` `FAIL_CLOSED_HOOKS`), closing a
  second, undocumented, unaudited off-switch. The only supported relaxation is the
  documented, gate-logged `ESCC_OUTBOUND_GATE=off`.

## How it was verified

- **`npm test`: 474 tests green** (with `ajv`), including new no-`ajv`
  child-process tests and fail-closed-on-crash / non-disableable dispatcher tests.
- **A no-`node_modules` git worktree** (the exact marketplace runtime) was swept:
  **40/40 checks** — every hook script, every `escc` subcommand, the statusline,
  and session lifecycle run with **zero `MODULE_NOT_FOUND`**, and the send-gate
  was proven to **block an unapproved draft → accept an approval written without
  `ajv` → allow the approved draft**, and to **still block when listed in
  `ESCC_DISABLED_HOOKS`**.

## Upgrade

```bash
/plugin marketplace update escc && /plugin install escc@escc
```

No configuration changes. No API or behavioural changes for a correctly installed
`1.1.0` — this patch only makes a dependency-less install behave the way a
`1.1.0` install with dependencies already did, and removes the silent off-switch.

## Breaking changes

None.
