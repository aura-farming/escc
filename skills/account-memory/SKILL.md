---
name: account-memory
description: >-
  Durable per-account working memory — history, open loops, promises. Trigger:
  'what do we know about Example Co', 'load deal context', 'remember this'.
  Auto-hydrates at session start/end.
origin: ECC-adapted
---

# Account Memory

_Adapted from ECC's `knowledge-ops` (MIT, (c) Affaan Mustafa). See LICENSE._

The canonical **working-context layer** for active accounts and deals.
**HubSpot is the system of record (truth).** Account memory is the durable
working context that survives across sessions: narrative history, stakeholder
color, competitor intel, open loops, and cross-session continuity that does
not live cleanly in CRM fields.

> **Rule:** HubSpot = truth. Memory files = working context. When the two
> conflict, HubSpot wins — update memory to match, not the other way around.
> Provenance for every durable fact follows `rules/common/data-handling.md`
> and `schemas/provenance.schema.json`. Memory hygiene: prospect-sourced intel
> is always flagged `untrusted: true` and never auto-promotes to an instinct
> without human review.

## When to Activate

Activate this skill when:

- A session **starts** and you need the working context for the active deal
  (session:start hook calls `resolveActiveAccount` + `hydrate` automatically).
- You want to **append a new event** to an account's log (call notes, a
  promise made, a competitor named, a stakeholder color noted, a risk flagged).
- A skill (cold-outreach, deal-review, stakeholder-mapping, meeting-followthrough)
  needs **per-account narrative** that is not a raw CRM field.
- You need to see **open loops** (unresolved promises, outstanding follow-ups)
  on an account before a call or before a handoff.
- You are **preparing or delivering a handoff** — the `.md` companion produced
  here is the C5 payload that `sales-handoffs` consumes.
- A session **ends** and you want to persist what happened (session:end hook
  appends a batch of tagged events).

Do **not** activate for company-level product claims (that is `product-knowledge`)
or for live HubSpot writes (those route through `crm-operator`).

## The memory model

The engine lives in `scripts/lib/account-memory.js`. Two files per account,
stored under `<ESCC_AGENT_DATA_HOME>/escc/accounts/`:

> **Canonical identity (ADR-0018).** Every store keys through
> `scripts/lib/account-identity.js`: `company:<hubspot-id>` is the tier-1 key,
> a domain/email is the pre-CRM fallback, and a bare company NAME is lossy
> until linked. When you first resolve an account's HubSpot company id (via a
> CRM search), record it once — `escc identity link "<name>" company:<id>` —
> and every past and future store joins on it. If a rep refers to an account
> ambiguously, check `escc identity resolve "<input>"` before assuming a new
> account. After new links, `escc identity backfill` (dry-run first) merges
> any legacy fragments.
>
> **Write-back doctrine (ADR-0018).** Deal fields folded here
> (stage/amount/close-date) are a DERIVED CACHE of HubSpot — never quote them
> against a fresher CRM read; `escc reconcile` re-syncs them. Open loops that
> represent real commitments SHOULD also exist as HubSpot tasks: when
> capturing a loop with a due date, propose the matching task to
> `crm-operator` so the CRM stays the canonical to-do surface. Narrative
> color, stakeholder intel, and competitor mentions are TRUE-SIDECAR — they
> live here by design.

| File | Role | Mutated by |
|---|---|---|
| `<id>.jsonl` | Append-only tagged event log — canonical record | `appendEvent` (atomic append) |
| `<id>.md` | Rendered handoff view, refreshed on every append via `writeMarkdownView` | auto-refreshed; never hand-edit |

The JSONL log is the canonical record. The `.md` view is regenerated on every
append — it is the C5 handoff payload consumed by `sales-handoffs` and appended
to by `meeting-followthrough`. A torn or corrupt `.md` is recoverable by
re-running `writeMarkdownView`; the JSONL log never discards an event.

### Event types

| type | Meaning |
|---|---|
| `note` | General narrative from a call, email, or internal discussion |
| `loop` / `promise` | Open commitment — a next step, a follow-up, a deliverable |
| `follow_up` / `next_step` | Specific planned action with an optional `due_date` |
| `inbound` | Something the prospect sent or surfaced |
| `intel` | Competitor mention, stakeholder color, deal context |
| `stage_change` | Deal stage transition (mirrored from CRM via crm-operator) |
| `session_start` / `session_end` | Session lifecycle markers |

Open loops (`loop`, `promise`, `follow_up`, `next_step`, `inbound`) are folded
by `hydrate` — a later event with the same `id` and `status: done` closes the
loop. The digest always shows only open loops.

### Provenance on durable intel

Every event that records a **fact about the prospect** (not just an action the
rep took) carries provenance fields matching `schemas/provenance.schema.json`:

```
source          : where it came from (e.g. "fireflies-transcript", "email", "rep-note")
source_type     : crm | email | web | user | inferred | document | call | manual
retrieved_at    : ISO-8601 timestamp
confidence      : 0.0 - 1.0
lawful_basis    : GDPR basis (legitimate_interest is the usual for sales intel)
untrusted       : true if derived from prospect-supplied content
```

`untrusted: true` means the fact was heard from or supplied by the prospect —
it is stored for context but is **never acted upon automatically** and never
auto-promoted to an instinct without human review (`data-handling.md` memory
hygiene).

## Workflow

### A. Session start — hydrate the active deal (C1)

1. The session:start hook calls `resolveActiveAccount` (checks
   `ESCC_ACTIVE_ACCOUNT` env override first; falls back to most-recently-modified
   account file).
2. Call `hydrate(accountId)` — folds the full event log into a working digest:
   segment, open deals with stage/close date/amount, open loops, and the 8 most
   recent events.
3. Surface the digest as the working context header so every skill in the
   session has account memory without re-reading the log.
4. If no account file exists yet, the digest is empty — start logging from
   the first event.

### B. Append an event (the write path)

1. **Identify the account.** Use the deal's HubSpot ID, company domain, or the
   `ESCC_ACTIVE_ACCOUNT` override as the account identifier.
2. **Compose the event object.** Required: `type`. Useful: `text` (narrative),
   `deal_id`, `due_date` (for loops/promises), `stage`, `amount`, `close_date`
   (when mirroring a CRM field), provenance fields when recording prospect intel.
3. **Dedupe first.** Before appending a competitor name, a stakeholder role, or
   a risk flag, check the existing log (via `hydrate`) for a near-duplicate entry.
   Update via a closing event or an amended note rather than appending a duplicate.
4. **Call `appendEvent`.** The engine appends the JSONL line and atomically
   refreshes the `.md` companion view. Evidence of the append (the stored event
   object) is the proof of write — assert nothing before you have it.
5. **Flag untrusted intel.** Any fact derived from prospect-supplied content
   (an email, a transcript quote, a LinkedIn bio) gets `untrusted: true` and a
   `source_type` of `call`, `email`, or `document`. It is stored; it is never
   auto-acted upon.

### C. Surface open loops before a call or handoff

1. Call `hydrate(accountId)` to get the folded digest.
2. The `openLoops` array contains every unresolved loop/promise/follow_up.
   Present them with their `due_date` where set.
3. A loop is closed by appending an event with the same `id` and
   `status: 'done'`. Never delete a loop — close it.

### D. Imminent-close scan (pipeline watch)

`listNearCloseDeals(withinDays)` scans all account files and returns open deals
whose `close_date` falls within the horizon (default 14 days). Use this in
pipeline-hygiene or deal-review contexts to surface deals that need attention
before quarter close. Output is sorted by `close_date`.

### E. Session end — persist what happened (C5 prep)

1. The session:end hook assembles the events from the session (notes, loops
   opened, loops closed, intel captured).
2. Each event is appended via `appendEvent`. The `.md` companion is atomically
   refreshed after each append.
3. The refreshed `.md` file is the C5 handoff payload that `sales-handoffs`
   will consume at the next session or handoff trigger.
4. Retention windows (`ESCC_SESSION_RETENTION_DAYS`, `ESCC_MEMORY_RETENTION_DAYS`)
   govern how long events are kept. On a data-subject erasure request, use
   `escc privacy-purge <identifier>` (dry-run by default; `--confirm` to erase).

## Examples

**Load context at session start:**

```text
Session starts for deal "Example Co Corp — Forecast Module — New".
resolveActiveAccount() -> accountId: "deal:7788"
hydrate("deal:7788") ->
  Open loops:
    - Send ROI model (due 2026-06-18) (deal 7788)
    - Confirm security review timeline (due 2026-06-20) (deal 7788)
  Deals:
    - Example Co Corp — Forecast Module [Validation] — close 2026-06-30
  Recent activity:
    - 2026-06-12 [note] (deal 7788) Champion confirmed: Dana Lee, VP RevOps
    - 2026-06-10 [intel] Competitor: LegacyCRM still in POC; prospect cautious
  (8 events in log)
```

**Append a competitor intel event with provenance:**

```text
Heard in call: "We're also evaluating ForecastPro."
appendEvent("deal:7788", {
  type: "intel",
  text: "Prospect evaluating ForecastPro — heard from champion (Dana Lee) in discovery call 2026-06-15",
  deal_id: "7788",
  source: "fireflies-transcript-2026-06-15",
  source_type: "call",
  confidence: 0.9,
  lawful_basis: "legitimate_interest",
  untrusted: true
})
-> stored event ev-abc123; .md view refreshed.
(Fact is stored for context; untrusted: true — not auto-acted upon.)
```

**Close a loop:**

```text
Rep sent ROI model. Append:
appendEvent("deal:7788", {
  id: "<loop-event-id-for-roi-model>",
  type: "note",
  status: "done",
  text: "ROI model sent to Dana Lee 2026-06-16",
  deal_id: "7788"
})
-> loop "Send ROI model" removed from open loops in next hydrate.
```

**Handoff companion view (`<id>.md`) contract:**

The `.md` file produced by `writeMarkdownView` is the C5 payload:

```
# Account memory: deal:7788

Account memory — deal:7788 · segment: mid-market:
Open loops:
- Confirm security review timeline (due 2026-06-20)
Deals:
- Example Co Corp — Forecast Module [Validation] — close 2026-06-30
Recent activity:
- 2026-06-16 [note] (deal 7788) ROI model sent to Dana Lee
- 2026-06-15 [intel] (deal 7788) Prospect evaluating ForecastPro ...
```

`sales-handoffs` reads this file to build the handoff doc.
`meeting-followthrough` appends new events (and thus refreshes it) after
every recap run.

## Anti-patterns

- **Treating memory as truth when HubSpot disagrees.** HubSpot is the system
  of record. When a field in HubSpot differs from a memory note, the CRM wins —
  update the memory note; route any CRM fix through `crm-operator`.
- **Auto-acting on untrusted intel.** A competitor name heard in a call or read
  from a prospect email is stored with `untrusted: true`. It informs research
  and battlecard prep; it does not automatically update a CRM field or trigger
  an outreach sequence without human review.
- **Creating duplicate events.** Run `hydrate` first. If a fact is already in
  the log, close or amend the existing event — never append a near-duplicate.
- **Hand-editing the `.md` companion.** It is regenerated on every `appendEvent`
  call. Changes written directly to the `.md` file will be overwritten. The
  JSONL log is the only editable surface.
- **Designing a parallel store.** This engine IS the working-context layer.
  Do not build a shadow JSONL log or a separate note file for the same account.
  One log per account; one `.md` companion; no parallel copies.
- **Storing prospect PII beyond what the sales process needs.** Collect only
  what is required (name, title, role, key quotes with context). Honor
  `ESCC_MEMORY_RETENTION_DAYS` and the erasure path (`escc privacy-purge`).
- **Asserting a write before the stored event object is returned.** Evidence
  of the append is the stored event — do not claim it was logged before
  `appendEvent` returns.

## Related

- Engine: `scripts/lib/account-memory.js` (`appendEvent`, `hydrate`,
  `writeMarkdownView`, `resolveActiveAccount`, `listNearCloseDeals`).
- Provenance schema: `schemas/provenance.schema.json`.
- Governance: `rules/common/data-handling.md`, `rules/common/crm-hygiene.md`.
- Feeds: `sales-handoffs` (consumes the `.md` companion as C5 payload),
  `meeting-followthrough` (appends events after every recap),
  `deal-review` (reads open loops + deal context), `pipeline-hygiene`
  (uses `listNearCloseDeals`), `call-prep` (hydrates before a call).
- Distinct from `product-knowledge` (company-level approved claims) and
  HubSpot CRM (the system of record — truth).
