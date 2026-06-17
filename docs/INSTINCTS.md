# ESCC Instincts

The instinct engine is ESCC's continuous-learning subsystem. It observes a
session, distills repeating patterns into candidate instincts, scores their
confidence on real outcomes, decays them over time, and -- only after a human
approves them -- lets them inform future sessions and graduate into reusable
playbooks.

It is a **Node rewrite**. ECC implemented continuous learning in Python + bash;
ESCC reimplements the concept in plain CommonJS so the harness keeps `ajv` as its
sole dependency. The management surface (review, promote, evolve, export/import)
is the `instincts` skill (`skills/instincts/SKILL.md`); the engine lives in
`scripts/instincts/`:

- `observe.js` -- turns a hook payload into one observation row (capture-side
  guard).
- `distill.js` -- derives trusted signals, clusters them, drafts instincts,
  weights confidence by outcomes.
- `lifecycle.js` -- decay, manager-gated promotion, evolve, the review gate.
- `instinct-store.js` -- the persistence/data layer (workspace keying,
  observation log, instinct files, id registries).
- `instinct-cli.js` -- the `{ code, text, data }` handlers behind the slash
  commands.

---

## The lifecycle

```text
observe  ->  distill  ->  review  ->  evolve  ->  promote
(capture)   (draft +     (human      (graduate   (personal ->
            confidence)   approve/    domains     team, manager-
                          reject)     to skills)  gated)
```

### Observe

The `pre:observe` and `post:observe` hooks (running `observe-runner.js`) record
a compact observation per tool call. The row captures the tool name, the event
(`pre`/`post`), the session id, an `untrusted` flag, and (post only) whether the
call errored. It **never** stores tool OUTPUT content. Observations append to
`observations.jsonl` in the rep's workspace.

### Distill

`distill.js` reads the full observation log and derives **trusted signals** of
three kinds, then clusters them by a stable key and counts frequency:

| Signal kind | Clustering threshold | Tentative base confidence |
|---|---|---|
| `user_correction` | 1 occurrence | 0.5 |
| `error_resolution` | 2 occurrences | 0.4 |
| `tool_sequence` | 3 occurrences | 0.4 |

A cluster that meets its threshold is drafted into an instinct. Distillation is
idempotent: it recomputes from history each run, preserves an existing
instinct's `created` timestamp and decay-exempt flag, and skips any id a human
has rejected.

### Review (the human gate)

No instinct is active until a human approves it. Every freshly distilled instinct
is a proposal in the pending-review queue. The review surface is
**`/instinct-status`**, which lists personal and team instincts and flags the
pending ones. Approve with `/instinct-status --approve <id>`; reject with
`/instinct-status --reject <id>`. Rejection is permanent -- the id is recorded so
distill never resurrects it. Approval records the id so it drops off the pending
list.

### Evolve

When a domain accumulates a strong-enough cluster, it can graduate into a
reusable playbook. `/evolve` checks each domain against a pinned threshold --
**>= 3 instincts in the domain with average confidence >= 0.70** -- and writes a
DRAFT skill per qualifying domain into the workspace `evolved/skills/` directory,
tagged `provenance: evolved`. A draft is not live: it must pass the same
frontmatter + content-guard + CI validators as curated content (`npm test`)
before being treated as an active skill. The threshold is a deliberate quality
floor, not a heuristic; do not lower it to force graduation.

### Promote

Promotion moves a personal instinct to team scope so every rep in the workspace
sees it. There is **no automatic promotion path.** `/instinct-promote <id>` is
manager-gated: it succeeds only when the caller's role (from `ESCC_ROLE` /
`ESCC_REP_ROLE`) is in the manager set -- `manager`, `sales-manager`, `revops`,
`vp`, `cro`, `admin`. A non-manager role returns `role_required` and the instinct
stays personal. On success the personal copy is removed (no duplicates).

---

## Confidence scoring

Confidence lives nominally between 0.3 (tentative) and 0.9 (near-certain). It
moves on real outcome signals, not on raw frequency -- frequency only sets a
tentative baseline (a tiny per-occurrence nudge above threshold, capped so it
never dominates).

A **real outcome** confirms an instinct only when the outcome's domain matches
the instinct's domain. Outcome events and their domains:

| Outcome event | Domain it confirms |
|---|---|
| `reply_received` | outreach |
| `sequence_step_engaged` | outreach |
| `meeting_booked` | outreach |
| `deal_stage_advanced` | deals |

Confidence adjustments:

| Event | Effect |
|---|---|
| Matching real outcome | +0.05 each (capped at 6 events) |
| User contradiction / explicit correction | -0.10 |
| Confirmation | +0.05 |
| Time decay (per week, per domain) | outreach / deals / crm: -0.03; process / preferences: -0.02 |

Sales domains (outreach, deals, crm) decay faster than durable process and
preference instincts because what worked last quarter may not work now.
Decay-exempt instincts (seeds and safety instincts) never decay. The decay sweep
runs at SessionStart and re-anchors `last_observed` to "now" so repeated sweeps
within a week do not compound. After a sweep, any instinct below the retire floor
(0.20) is removed automatically.

---

## The memory-hygiene rule (non-negotiable)

**Instincts NEVER auto-form from prospect-supplied or untrusted content.** This
is the safety guarantee that lets the engine learn without becoming an attack
surface, and it is enforced in code -- asserted by a content-guard test that must
not be weakened.

Two enforcement points:

- **Capture side (`observe.js`).** Tools whose output carries externally-authored
  content are tagged `untrusted: true` by tool identity -- web fetch/search,
  Gmail read/search/list (prospect threads), Fireflies (call transcripts),
  scraped or search results, Intercom (customer-authored messages), and
  browser-inspection tools. The rep's own actions (Edit/Write/Bash/CRM writes,
  composing a draft) are deliberately NOT tagged -- they are the legitimate
  source of instincts. Tagging is conservative by design: over-tagging an
  external read only costs a low-signal learning opportunity, whereas
  under-tagging risks learning from injected content.
- **Distill side (`distill.js`).** Any observation tagged `untrusted: true`, or
  carrying tool-output content, is dropped before signal derivation. So a
  prompt-injection buried in a prospect email, website, attachment, call
  transcript, or CRM record can never become a learned behavior.

The engine derives candidates from exactly three approved sources: user-prompt
corrections, user-initiated tool sequences, and error resolutions. The
background `instinct-observer` agent (haiku, read-only) only proposes; nothing it
proposes is active until a human approves it at `/instinct-status`. Do not use
`/learn` to record a prospect's instruction ("they told me to open with X") --
that is untrusted content and violates the same guard.

---

## Project-scoped (workspace-scoped) instincts

Instincts are scoped to the **rep identity**, not to a git repository. ECC keyed
its learning store on the git remote / repo path; that has no meaning on a
HubSpot + Gmail surface, so ESCC re-keys it.

The workspace id is a stable hash of the rep identity, resolved from
`ESCC_REP_IDENTITY` / `ESCC_HUBSPOT_OWNER` / `ESCC_SENDER_EMAIL` (falling back to
`default`). Each workspace holds its own observation log, instinct files, and id
registries under the store root (overridable with `ESCC_INSTINCT_HOME`). This
keeps one rep's learning from contaminating another's, and keeps personal habits
out of the shared team scope until a manager explicitly promotes them.

Two scopes, plus a per-instinct applicability filter:

| Scope | Who sees it | How it gets there |
|---|---|---|
| personal | only this rep | auto-proposed by the observer, approved by the rep at `/instinct-status` |
| team | all reps in the workspace | a manager promotes via `/instinct-promote` |

An instinct may also carry an `applies_to` segment filter (for example
`enterprise,mid-market`), so SessionStart injects it only when it matches the
active account's segment; generic process instincts without a target stay global
within their scope.

---

## The instinct record

Instinct files are human-reviewable frontmatter `.md` files validated against
`schemas/instinct.schema.json`. Required fields: `id`, `trigger`, `confidence`,
`domain`, `scope`, `created`. The `domain` is one of `outreach`, `deals`,
`process`, `crm`, `preferences`; `scope` is `personal` or `team`. Optional fields
include `source`, `applies_to`, `last_observed`, `decay_exempt`, `action`, and
`evidence`. Confidence is constrained to 0..1 in the schema (the nominal working
range is 0.3-0.9; the wider bound lets the decay sweep push a value below 0.3
toward retirement without failing validation).

---

## Retention

Two environment variables control durable-store retention beyond session
summaries (both blank by default, meaning keep indefinitely):

- **`ESCC_MEMORY_RETENTION_DAYS`** -- retention for account-memory entries (the
  durable per-entity store).
- **`ESCC_OBSERVATION_RETENTION_DAYS`** -- retention for the continuous-learning
  observation store.

For subject-level erasure (for example a GDPR request), `escc privacy-purge
<identifier>` removes a subject across the local stores -- HubSpot pointer,
account-memory, session-data, observations, and instinct evidence -- and is
dry-run unless `--confirm` / `--yes` is passed.

---

## Related files

- `skills/instincts/SKILL.md` -- the human-facing management workflow (review,
  promote, evolve, export/import, `/learn`, `/skill-create`).
- `scripts/instincts/observe.js` -- capture-side untrusted-content guard.
- `scripts/instincts/distill.js` -- signal derivation, clustering, confidence,
  the distill-side guard.
- `scripts/instincts/lifecycle.js` -- decay, promotion, evolve, the review gate.
- `scripts/instincts/instinct-store.js` -- workspace keying and persistence.
- `scripts/instincts/instinct-cli.js` -- the slash-command handlers.
- `schemas/instinct.schema.json` -- the instinct record schema.
- `.env.example` -- the instinct retention variables; the rep-identity and
  instinct-home vars are resolved in `instinct-store.js` (above).
- `docs/ARCHITECTURE.md` -- where the instinct engine sits in the machinery
  plane.
