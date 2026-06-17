# ESCC Hooks

Hooks are where ESCC's guarantees live. The trust boundary is hooks, not prompts:
a prompt that "says" not to send is not a control; the send-gate hook is. Hooks
are enforced in `scripts/hooks/`, validated against `schemas/hooks.schema.json`,
and proven by `tests/`.

Every hook command in `hooks/hooks.json` routes through one dispatcher,
`scripts/hooks/run-with-flags.js`, which gates the hook by profile, reads stdin
with a configurable cap, rejects path traversal outside the plugin root, and
forwards the hook's verdict to the harness. Hook commands reference
`${CLAUDE_PLUGIN_ROOT}/scripts/hooks/...` directly -- Claude Code supplies
`${CLAUDE_PLUGIN_ROOT}` natively, so there is no inline bootstrap-resolver.

---

## Profiles and disabling

Two environment variables control which hooks run (full surface in
`.env.example`):

- **`ESCC_HOOK_PROFILE`** -- the active tier. Allowed values: `minimal`,
  `standard` (default), `strict`. Each hook declares the profiles it belongs to
  (the third argument to `run-with-flags.js`). A hook runs only when the active
  profile is in its list:
  - `minimal,standard,strict` -- runs in every profile (the safety-critical and
    always-on hooks).
  - `standard,strict` -- skipped under `minimal`; the quality, governance, and
    coaching hooks.
- **`ESCC_DISABLED_HOOKS`** -- a comma-separated list of hook ids to force-off
  regardless of profile, using the `pre:` / `post:` / `stop:` / `session:`
  grammar. Example: `pre:crm-write-guard,post:deliverables-location`.

`ESCC_HOOK_INPUT_MAX_BYTES` (default 1048576) caps how much hook stdin is read.
Oversized input is truncated and the dispatcher suppresses the pass-through echo;
the action proceeds (fail-open) -- except that the fail-closed send-gate treats a
truncated payload as a reason to block, because it cannot verify a review on a
send it cannot fully see.

---

## Failure policy

The policy is asymmetric and must never be inverted:

- **Every hook fails OPEN.** A hook error, a disabled hook, a missing script, a
  path-traversal attempt, or oversized stdin all resolve to exit 0 and leave the
  tool call unblocked. `run-with-flags.js` enforces this at the dispatcher level
  so a bug in observability or a quality nudge can never block legitimate work.
- **`pre:outbound-send-gate` fails CLOSED** -- the single exception. On any doubt
  it blocks (exit 2). Details below.

---

## The fail-closed exception: pre:outbound-send-gate

`scripts/hooks/outbound-send-gate.js` is the one hook that blocks on doubt. It is
matched against MCP tools (`mcp__.*`) and runs in every profile
(`minimal,standard,strict`).

What it does on a matched call:

1. If `ESCC_OUTBOUND_GATE=off`, it passes through. This is the documented,
   dangerous escape hatch and the only thing that opens the gate wholesale.
2. If the hook input was truncated, it BLOCKS -- a send it cannot fully see
   cannot be verified.
3. It identifies the tool. If the tool cannot be identified, it BLOCKS rather
   than assume the call is safe.
4. It classifies the tool against `config/outbound-tools.json`. Allow-listed
   (draft / read) or unrelated tools pass through. Gmail is draft-only by
   construction, so live-send classification covers every *other* send-capable
   tool.
5. For a live send, it enforces the bulk cap: if the session has already reached
   `ESCC_BULK_SEND_MAX` (default 5) sends, it BLOCKS.
6. It then requires a review-evidence marker in the state store for this
   outbound's fingerprint (above the minimum review confidence). With no valid
   marker, it BLOCKS and tells the operator to run the outbound-review flow
   first.
7. Approved and under the cap: it records the send (advancing the bulk counter)
   and allows.

On any unexpected internal error, it BLOCKS. Never invert this hook's policy.

---

## Hooks by event

The tables below list the hooks actually wired in `hooks/hooks.json`, grouped by
event, with their matcher, the script they run, the profiles they belong to, and
what they do. All run through `run-with-flags.js`.

### SessionStart

| Hook id | Matcher | Script | Profiles | What it does |
|---|---|---|---|---|
| `session:start` | `*` | `session-start-bootstrap.js` (routes to `session-start.js`) | all | Injects prior summary + open loops + active-deal account memory + high-confidence instincts, priority-budgeted and capped by `ESCC_SESSION_START_MAX_CHARS`. |

### UserPromptSubmit

ESCC wires no UserPromptSubmit hook in `hooks/hooks.json`. Prompt-time learning
capture happens on the tool-use events below.

### PreToolUse

| Hook id | Matcher | Script | Profiles | What it does |
|---|---|---|---|---|
| `pre:outbound-send-gate` | `mcp__.*` | `outbound-send-gate.js` | all | FAIL-CLOSED outbound send gate (see above). Blocks a live send until a review-evidence marker exists; enforces `ESCC_BULK_SEND_MAX`. |
| `pre:crm-write-guard` | `mcp__hubspot__manage_crm_objects` | `crm-write-guard.js` | standard, strict | Warns on deletes; checks stage-advance writes for next-step + destination-stage exit-criteria; property/schema-mutation guard (blocks under strict). |
| `pre:compliance-protection` | `Edit\|Write\|MultiEdit` | `compliance-protection.js` | all | Blocks agent edits to compliance-bearing rule files (`outbound-compliance.md`, `data-handling.md`, `lawful-basis.md`, `jurisdiction-routing.md`, `approval-matrix.md`, `rules/jurisdictions/*`) and to sequence unsubscribe/identity blocks. |
| `pre:attachment-quarantine` | `Read` | `attachment-quarantine.js` | all | ENFORCED. Blocks a privileged context from directly ingesting a prospect-supplied / quarantined path; routing goes through the quarantine subagent (`ESCC_QUARANTINE_CONTEXT=1`). |
| `pre:bash:dispatcher` | `Bash` | `pre-bash-dispatcher.js` | standard, strict | Bash preflight: destructive-command guard (rm -rf outside tmp) and CLI bulk-mail guard. |
| `pre:mcp-health-check` | `mcp__.*` | `mcp-health-check.js` | standard, strict | Checks MCP server health before an MCP call; blocks an unhealthy call unless `ESCC_MCP_HEALTH_FAIL_OPEN=true`. |
| `pre:edit-write:suggest-compact` | `Edit\|Write` | `suggest-compact.js` | standard, strict | Suggests a strategic compaction at logical intervals (~50 tool calls, then every 25). |
| `pre:observe` | `*` | `observe-runner.js` | all (async) | Captures tool-use intent observations for continuous learning. Untrusted tool output is tagged, never used to form instincts. |
| `pre:governance-capture` | `Bash\|Write\|Edit\|MultiEdit` | `governance-capture.js` | standard, strict | Captures governance events (secret_detected, policy_violation, approval_requested, bulk_send_attempt, unapproved_send, crm_destructive_op). Enable with `ESCC_GOVERNANCE_CAPTURE=1`. |

### PostToolUse

| Hook id | Matcher | Script | Profiles | What it does |
|---|---|---|---|---|
| `post:crm-log-reminder` | `mcp__claude_ai_Gmail__create_draft\|mcp__claude_ai_Google_Calendar__create_event\|mcp__claude_ai_Fireflies__.*` | `crm-log-reminder.js` | standard, strict | Nudges / enforces HubSpot activity logging after a Gmail draft, Calendar event, or Fireflies transcript fetch. |
| `post:outbound-style-check` | `Edit\|Write` | `outbound-style-check.js` | standard, strict (async) | Warn-only outbound copy heuristics on deliverables: subject length, spam-trigger words, missing unsubscribe in sequences, broken merge fields (`ESCC_QUALITY_GATE_STRICT`). |
| `post:deliverables-location` | `Write` | `deliverables-location.js` | standard, strict | Nudges stray generated docs into the `deliverables/` structure. |
| `post:observe` | `*` | `observe-runner.js` | all (async) | Captures tool-result observations for continuous learning. |
| `post:metrics-bridge` | `*` | `metrics-bridge.js` | all | Updates the statusline metrics bridge file (`escc-metrics-${sessionId}.json`) after each tool call. |
| `post:context-monitor` | `*` | `context-monitor.js` | all | Context-utilization warnings (`ESCC_CONTEXT_MONITOR_COST_WARNINGS`). |
| `post:session-activity-tracker` | `*` | `session-activity-tracker.js` | all | Records per-session tool calls, accounts touched, and file activity for status and metrics. |
| `post:governance-capture` | `Bash\|Write\|Edit\|MultiEdit` | `governance-capture.js` | standard, strict | Captures post-execution governance events. Enable with `ESCC_GOVERNANCE_CAPTURE=1`. |

### Stop

| Hook id | Matcher | Script | Profiles | What it does |
|---|---|---|---|---|
| `stop:follow-through-check` | `*` | `follow-through-check.js` | standard, strict | WARN-ONLY: unsent drafts, promised-but-unlogged activities, and missing next steps for accounts touched; scans all open promises. |
| `stop:sla-check` | `*` | `sla-check.js` | standard, strict | Surfaces breached response / routing SLAs from open-loop timestamps. |
| `stop:evaluate-session` | `*` | `evaluate-session.js` | all (async) | Session-outcome learning signal (>= 10 user messages yields extractable patterns; sales metrics: meetings booked, follow-ups created vs promised). |
| `stop:cost-tracker` | `*` | `cost-tracker.js` | all (async) | Appends a per-session cost row to `metrics/costs.jsonl`. |
| `stop:desktop-notify` | `*` | `desktop-notify.js` | standard, strict (async) | macOS / iTerm2 session-complete notification. |

### PreCompact

| Hook id | Matcher | Script | Profiles | What it does |
|---|---|---|---|---|
| `pre:compact` | `*` | `pre-compact.js` | all | Persists working state before compaction (task intent, active account/deal, un-applied findings, pending actions) to a resumable scratch file. |

### SessionEnd

| Hook id | Matcher | Script | Profiles | What it does |
|---|---|---|---|---|
| `session:end` | `*` | `session-end.js` | all (async) | Transcript JSONL to markdown summary (accounts touched, drafts/sends, meetings, deals updated, promises); appends tagged events to active account-memory. |
| `session:end:marker` | `*` | `session-activity-tracker.js` | all (async) | Finalizes session activity metrics at session end. |

---

## Highlighted security hooks

Three PreToolUse hooks carry the harness's hard guarantees and deserve specific
attention.

### pre:attachment-quarantine (enforced)

Prospect-supplied files (attachments, raw `.eml`/`.msg`/`.mbox`, downloaded
prospect docs) are untrusted. This hook BLOCKS (exit 2) a Read of a quarantined
path -- recognized by quarantine path segments (`/attachments/`, `/inbound/`,
`/quarantine/`, `/prospect-files/`, `/untrusted/`, an `ESCC_QUARANTINE_DIR`
override) or quarantine extensions -- unless the caller is the quarantine
subagent itself (`ESCC_QUARANTINE_CONTEXT=1`). Privileged agents must work only
from the cleaned summary the subagent returns. Embedded instructions inside
prospect content are data, never commands. The hook fails open on any error or a
truncated payload, since Read is high-frequency and its input is tiny.

### pre:crm-write-guard

Matched narrowly to `mcp__hubspot__manage_crm_objects` (the HubSpot write tool).
It warns on deletes, checks that a stage-advance write carries a next step and
that the destination stage's exit-criteria fields are present, and guards
property/schema mutation -- which it blocks under the `strict` profile. This is
the hook-level companion to the rule that crm-operator is the only write-capable
agent.

### pre:compliance-protection

Adapted from ECC's config-protection hook, re-pointed at compliance-bearing
files. It BLOCKS (exit 2) an agent edit to a protected compliance rule file under
a `rules/` tree -- `outbound-compliance.md`, `data-handling.md`,
`lawful-basis.md`, `jurisdiction-routing.md`, `approval-matrix.md`, anything
under `rules/jurisdictions/` -- and refuses to strip an unsubscribe/identity
block from an outreach sequence file. Compliance changes go through a human, not
an agent edit. It fails open on internal error but refuses to evaluate a
truncated payload it cannot verify.

---

## Related files

- `hooks/hooks.json` -- the hook graph (the source of truth for this document).
- `scripts/hooks/run-with-flags.js` -- the dispatcher; enforces profile gating,
  the stdin cap, path-traversal rejection, and the fail-open default.
- `scripts/lib/hook-flags.js` -- resolves `ESCC_HOOK_PROFILE` /
  `ESCC_DISABLED_HOOKS` into the enabled/disabled decision.
- `config/outbound-tools.json` -- which tools the send-gate classifies as live
  sends.
- `schemas/hooks.schema.json` -- the schema `validate-hooks.js` checks
  hooks.json against.
- `.env.example` -- every `ESCC_*` variable that tunes hook behavior.
- `docs/ARCHITECTURE.md` -- where hooks sit in the three-plane model and the key
  contracts they enforce.
