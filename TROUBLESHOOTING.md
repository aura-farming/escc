# Troubleshooting

Practical fixes for common ESCC issues, in a problem -> cause -> fix format.
Most runtime behavior is tuned through `ESCC_*` environment variables — see
[`.env.example`](.env.example) for the full surface and defaults. All variables
are optional and fall back to the documented default.

If something feels wrong, first check which hook profile is active
(`ESCC_HOOK_PROFILE`, default `standard`) and whether any hooks are disabled
(`ESCC_DISABLED_HOOKS`). The trust boundary is hooks, not prompts, so behavior
you cannot explain from a SKILL.md is usually coming from a hook.

---

## The send-gate is blocking a legitimate send

**Problem.** A live outbound send is refused with a
`[outbound-send-gate] BLOCKED` message even though the message looks ready.

**Cause.** `pre:outbound-send-gate` is the one fail-closed hook in ESCC. It
blocks any live send — and any Gmail draft or HubSpot OUTBOUND email — until a
per-recipient **approval token** exists in the state store. The token is minted by
`escc outbound approve`, which (ADR-0020) requires the four deterministic gates
**and** an adversarial `outbound-reviewer` verdict at/above the confidence floor.
The gate also blocks on *any* doubt — truncated hook input, an unparseable
payload, missing config — and caps bulk sends at `ESCC_BULK_SEND_MAX` (default 5)
per session.

**Fix.**

1. **Use the blessed path.** `email-outbound-ops` (one message) or
   `/escc-worklist` (a batch) run the `outbound-reviewer` and mint the token for
   you. This resolves almost every legitimate block.
2. **Or approve directly with the reviewer verdict.** After running the reviewer,
   pass its result to approve:
   `escc outbound approve --input draft.json --review-verdict approved --review-confidence 0.9`.
   A block reading `adversarial-review: no ... verdict supplied` means exactly
   this step is missing.
3. **Check the bulk cap.** If you are sending in bulk and hit the limit, you have
   reached `ESCC_BULK_SEND_MAX` (default 5/session). Raise it deliberately
   (`ESCC_BULK_SEND_MAX=10`) only if the larger batch is genuinely intended.
4. **Remember Gmail is draft-only.** If you expected Gmail to send, it does not
   — it creates drafts by construction. Delivery happens through the gated path.
5. **Explicit exceptions, both logged.** `escc outbound approve --override
   "<reason>"` proceeds past a block (manager-signed under the strict profile);
   `ESCC_OUTBOUND_REQUIRE_REVIEW=off` falls back to four-gates-only for deliberate,
   supervised use. Prefer options 1–2.
6. **Last resort, dangerous.** `ESCC_OUTBOUND_GATE=off` disables the gate
   entirely and removes the protection that blocks un-reviewed live sends. It is
   a documented, dangerous escape hatch for deliberate, supervised testing only.
   Prefer options 1–2. If you use it, turn it back on immediately afterward.

---

## Hook false positives or too much hook noise

**Problem.** Hooks fire too often, warn on things you do not care about, or a
specific hook is getting in the way.

**Cause.** The active hook profile is too broad for your workflow, or one hook
is noisy.

**Fix.**

- **Switch profiles.** Set `ESCC_HOOK_PROFILE=minimal` to run the smallest set
  of hooks, `standard` (the default) for the normal set, or `strict` to escalate
  warn-only quality hooks toward blocking. Minimal is the quietest.
- **Disable individual hooks.** Set `ESCC_DISABLED_HOOKS` to a comma-separated
  list of hook ids using the `pre:` / `post:` / `stop:` / `session:` grammar,
  for example:

  ```bash
  export ESCC_DISABLED_HOOKS=pre:crm-write-guard,post:deliverables-location
  ```

- **Do not disable the send-gate this way to send faster.** Run the blessed path
  (or pass a reviewer verdict to `outbound approve`) instead (see above).
  Disabling `pre:outbound-send-gate` removes a fail-closed safety control.
- **Strictness knob.** If warn-only quality hooks are escalating to blocks
  unexpectedly, check `ESCC_QUALITY_GATE_STRICT` (default `false`).

---

## Observation or memory bloat

**Problem.** The instinct observation log or durable account memory grows large
over time, or you want stored prospect data to age out.

**Cause.** Durable stores keep data until a retention window is set. By default
the long-horizon stores keep data indefinitely (blank = keep), which is correct
for long-running accounts but accumulates over months.

**Fix.** Set retention windows (in days):

- `ESCC_OBSERVATION_RETENTION_DAYS` — prunes the continuous-learning observation
  store (the raw signals the instinct engine reads).
- `ESCC_MEMORY_RETENTION_DAYS` — prunes durable account-memory entries beyond
  session summaries.
- `ESCC_SESSION_RETENTION_DAYS` (default 30) — prunes `session-data/`
  summaries; `0` or `off` keeps all.

```bash
export ESCC_OBSERVATION_RETENTION_DAYS=90
export ESCC_MEMORY_RETENTION_DAYS=365
```

For a data-subject erasure request (GDPR), use `escc privacy-purge <identifier>`
to erase a specific entity's local stores (account-memory, observations,
instinct evidence). It is **dry-run by default; `--confirm` is required to
erase.** HubSpot rows and session-data are report-only and are handled by a
human / `crm-operator` — ESCC never deletes CRM records.

---

## `escc watch` runs too often or not often enough

**Problem.** The scheduled trigger sweep (overdue promises, imminent closes,
buying signals) fires on the wrong cadence.

**Cause.** The watch cadence is unset or set to a value that does not match your
rhythm.

**Fix.** Set `ESCC_WATCH_INTERVAL` to a duration with a suffix, e.g. `1h` or
`30m`. Blank uses the built-in default. `escc watch` is a read-only sweep that
routes severity-tagged alerts through the notification layer.

---

## Context injection at session start is too large or too small

**Problem.** The "welcome back" context block at session start is truncated in a
way that drops something important, or it is larger than you want.

**Cause.** The injected block is budgeted by category up to a character cap.

**Fix.**

- Adjust `ESCC_SESSION_START_MAX_CHARS` (default 8000). The budget is allocated
  by priority (resume state > overdue promises > imminent-close deals >
  active-account context > open loops > recent summary > instincts), so raising
  the cap surfaces more of the lower-priority categories.
- To turn injection off entirely, set `ESCC_SESSION_START_CONTEXT=off`.
- Frequent context-utilization or cost warnings can be toggled with
  `ESCC_CONTEXT_MONITOR_COST_WARNINGS` (default `on`).

---

## Plugin cache staleness (changes not showing up)

**Problem.** You edited a skill, command, or hook, but Claude Code still uses
the old version; or `escc:` skills do not reflect the latest repo state.

**Cause.** The plugin is loaded from a cached copy of the marketplace entry.

**Fix.**

1. Re-add the marketplace and reinstall the plugin:

   ```text
   /plugin marketplace add aura-farming/escc
   /plugin install escc
   ```

2. If counts or the command registry look out of date, regenerate them
   (see "`npm test` fails" below).
3. Confirm you are editing the repo that is actually installed, not a separate
   checkout.

---

## Permissions and CRLF line endings on Windows

**Problem.** Hook scripts do not execute, or validators flag files, on Windows.

**Cause.** Two common Windows issues: scripts losing their executable bit, and
files being checked out with CRLF (`\r\n`) line endings.

**Fix.**

- **Line endings.** Configure Git to preserve LF for this repo so shell scripts
  and Node hook files keep `\n`:

  ```bash
  git config core.autocrlf false
  git config core.eol lf
  ```

  If files are already checked out with CRLF, re-normalize and re-checkout.
- **Execution.** Hooks are invoked as `node <script>` via the dispatch runner,
  so a missing executable bit is usually not fatal; if you run a script
  directly and it fails, invoke it with `node` explicitly.
- **Paths.** Never commit personal absolute paths; CI
  (`validate-no-personal-paths.js`) will flag them regardless of platform.

---

## `npm test` fails

**Problem.** `npm test` exits non-zero.

**Cause.** `npm test` runs the full gate in sequence: the CI validators
(unicode-safety, agents, commands, rules, skills, hooks, manifests,
no-personal-paths), the catalog and registry checks, and then the unit and
content-guard tests (`tests/run-all.js`). Any one failing stops the run.

**Fix.**

1. **Run the failing validator on its own** to see the specific finding, e.g.:

   ```bash
   node scripts/ci/validate-skills.js
   node scripts/ci/validate-agents.js
   node scripts/ci/validate-hooks.js
   node tests/run-all.js
   ```

2. **Counts out of date.** If `catalog:check` fails because you added or removed
   a skill, agent, command, or rule, regenerate the pinned counts:

   ```bash
   npm run catalog:write
   ```

   Do not hand-edit the pinned counts in `README.md` — the catalog updater keeps
   the pin and the real count in sync.
3. **Command registry out of date.** If `registry:check` fails, regenerate it:

   ```bash
   npm run registry:generate
   ```

4. **Fix the source, not the validator.** Validators apply progressive
   strictness (pre-existing issues warn, new ones error under `CI_STRICT`).
   Resolve the underlying file; do not weaken a validator to make the run pass.
5. **A real agent safety failure is a stop sign.** If a content-guard test fails
   on agent-instruction-safety (read-only defaults, `crm-operator` as sole
   writer, approval language) or on the outbound-reviewer / compliance guards,
   treat it as a correctness bug in the content, not a flaky test.

---

## Where to look next

- Runtime knobs and defaults: [`.env.example`](.env.example)
- Security model and the trust boundary: [`SECURITY.md`](SECURITY.md)
- Repo conventions and policy: [`CLAUDE.md`](CLAUDE.md)
- Architecture decisions and their rationale: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Incident handling and breach timelines: `docs/INCIDENT-RESPONSE.md`
