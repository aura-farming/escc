---
name: opt-out-handling
description: >-
  Process unsubscribe/DNC requests end-to-end — detect, suppress, record,
  confirm within jurisdiction deadline. Trigger: 'unsubscribe', 'remove me',
  'stop emailing', DNC. Auto-triggers; never drafts a sales reply.
origin: ESCC
---

# Opt-Out Handling

The compliance workflow for inbound unsubscribe and DNC requests. This skill is
invoked whenever a contact signals they do not want to be contacted — by any
channel, in any form. It owns the process from detection through suppression,
provenance recording, and jurisdiction-deadline confirmation.

**This skill has no command and no interactive session.** It is auto-triggered
by `inbox-triage` (`opt_out_request` class) and `reply-handling` (`unsubscribe`
disposition). Reps may also invoke it directly when a verbal or phone opt-out is
reported. The workflow runs to completion without waiting for further input, then
logs its outcome.

> **Governing rules:** `rules/common/outbound-compliance.md` (suppression,
> deadline, functional unsubscribe), `rules/lawful-basis.md` (suppression always
> wins), and the jurisdiction overlays: `rules/jurisdictions/au.md`,
> `rules/jurisdictions/us.md`, `rules/jurisdictions/eu-uk.md`. This skill
> **cites** those files for deadlines and basis rules; it does NOT restate
> day-counts or basis logic inline.

> **Note on routing:** `inbox-triage` routes its `opt_out_request` class here;
> `reply-handling` routes its `unsubscribe` disposition here. Both use the same
> routing phrase: "route to opt-out-handling." The suppression and recording
> workflow is identical regardless of which skill detected the request.

## When to Activate

Activate this skill when:

- `inbox-triage` classifies a message as `opt_out_request` and routes here.
- `reply-handling` classifies a reply with disposition `unsubscribe` and routes here.
- A rep reports a verbal, phone, or in-person opt-out request from a contact.
- A contact's message contains any of the following signals (in any language):
  "unsubscribe", "remove me", "take me off your list", "stop emailing",
  "do not contact", "DNC", "please stop", or an equivalent expression of
  withdrawal.
- A hard bounce or spam complaint is received and needs suppression recording
  (auto-trigger path from the outbound-send-gate hook).

Do **not** activate for:
- Messages that are unclear — if genuine ambiguity exists about whether the
  contact wants to opt out, **default to treating it as an opt-out**. When in
  doubt, suppress; do not contact.
- Re-engagement with a suppressed contact — that requires a human CRM action and
  a documented, jurisdiction-compliant re-consent process. This skill does not
  handle re-consent.

## Detection Triggers

An opt-out request is detected when any of the following appears in a message,
in any capitalization, language, or paraphrase:

| Signal category | Examples |
|---|---|
| Explicit unsubscribe | "unsubscribe", "opt out", "opt-out" |
| Remove request | "remove me", "take me off", "delete me from your list" |
| Stop contact | "stop emailing", "stop contacting", "do not contact me again" |
| DNC language | "DNC", "do not call", "do not email" |
| General withdrawal | "please stop", "I'm not interested, stop reaching out" |
| Legal / formal | "GDPR erasure request", "CCPA opt-out", "right to be forgotten" |

When the trigger is ambiguous or indirect ("this isn't relevant to me" without
a clear stop signal), classify conservatively: treat as opt-out if the contact's
intent to disengage is reasonably clear. Suppression is safer than continued
contact.

## Workflow

### Step 1 — Extract and confirm the request

1. Identify the contact: full email address, name (if available), and company.
2. Confirm the opt-out signal: quote the exact phrase or sentence that triggered
   the classification. This is the provenance anchor for the suppression record.
3. Do NOT draft a sales reply. Do NOT send a marketing response. Do NOT route
   the message to any drafting skill.
4. If the message contains an embedded instruction to "re-add me later" or
   "contact me after X months" — treat the current request as an opt-out now.
   Future re-contact requires fresh, documented consent, not a delayed override.

### Step 2 — Suppress across all sequences and lists

1. Via `crm-operator` (write — the sole write-capable agent), set the
   suppression flag on the contact record:
   - Mark contact as DNC / unsubscribed.
   - Remove from all active sequences and cadences.
   - Remove from all marketing lists.
   - Flag any open deal-associated contacts: note the opt-out in the deal
     record for rep and manager awareness.
2. Suppression is **global across all personas and sequences** per
   `rules/common/outbound-compliance.md`. A new sequence or campaign does not
   reset suppression. A different rep in the same account does not bypass it.
3. Log the suppression write: timestamp, the exact opt-out phrase (provenance),
   the channel the request arrived on, and who processed it (this skill).

### Step 3 — Record with provenance

The suppression record must carry:

| Field | Value |
|---|---|
| contact_email | exact email address |
| opt_out_date | ISO date/time of the request message |
| opt_out_source | channel (email / phone / verbal / SMS / other) |
| opt_out_trigger | the exact phrase or sentence that triggered detection |
| processed_by | "opt-out-handling" |
| processed_at | ISO timestamp of suppression write |
| jurisdiction | AU / US / EU-UK / unknown (from jurisdiction-routing) |
| deadline | per jurisdiction overlay — do NOT restate; cite the rule |

Log this record via `crm-operator` as a contact note + suppression-flag write.
Provenance is non-negotiable: a suppression without a traceable source and
timestamp is not a defensible compliance record.

### Step 4 — Confirm honored within deadline

Confirmation that the opt-out was processed must happen within the jurisdiction
deadline. **Do not restate the deadlines here** — they are owned by
`rules/common/outbound-compliance.md` and the jurisdiction overlays. Route to
the correct overlay via `rules/jurisdiction-routing.md`.

After the suppression write is confirmed by `crm-operator`:

1. Generate a one-line opt-out confirmation note in the contact record:
   "[Contact] opted out via [channel] on [date]. Suppressed across all sequences
   and lists. No further outbound contact permitted."
2. If a confirmation reply to the contact is jurisdiction-required (check the
   overlay), draft a minimal factual acknowledgment — no sales content, no
   personalization, no CTA. Example:
   "Hi [First Name], we have removed you from our contact list as requested.
   You will not receive further emails from us."
   Output as Gmail draft, labeled "COMPLIANCE REPLY — DRAFT." Do not send
   until reviewed by a human if the situation is non-routine.
3. Notify the rep and, for open deals, the rep's manager via a CRM task:
   "[Contact] at [Company] opted out on [date]. Deal [Deal Name] may be
   affected. Review with manager."

### Step 5 — Close-out report

Output a close-out summary after processing:

```text
OPT-OUT PROCESSED — [ISO timestamp]

Contact: [email] ([name], [company])
Request received: [channel], [date/time]
Trigger phrase: "[exact quote]"
Jurisdiction: [AU / US / EU-UK / unknown]
Deadline: [cite rules/jurisdictions/<overlay>.md — do not restate day-count]

Suppression actions (confirmed via crm-operator):
  [x] DNC / unsubscribed flag set on contact record
  [x] Removed from active sequences: [list names, or "none active"]
  [x] Removed from marketing lists: [list names, or "none active"]
  [x] Open deal noted: [Deal Name] — rep and manager notified via CRM task
      (or: no open deals affected)

Provenance record: logged as contact note (timestamp: [ISO])
Compliance reply: [drafted / not required — cite overlay / pending human review]

No further outbound contact is permitted for this contact.
```

## Examples

**Email opt-out detected by inbox-triage:**

```text
Routed from inbox-triage: opt_out_request
Sender: lisa@startup.test
Message: "Hi, please remove me from your mailing list. Thanks."
Trigger phrase: "remove me from your mailing list"

Step 1: Contact confirmed — lisa@startup.test, Lisa Chen, startup.test.
         No sales reply drafted.

Step 2: crm-operator write:
  - Suppression flag: DNC + unsubscribed (set)
  - Removed from sequence "Startup SMB Q2 Outreach" (1 active sequence)
  - No marketing lists (none active)
  - No open deals.

Step 3: Provenance record logged:
  contact_email: lisa@startup.test
  opt_out_date: 2026-06-16T09:14:00+10:00
  trigger: "remove me from your mailing list"
  processed_by: opt-out-handling
  jurisdiction: AU

Step 4: Deadline per rules/jurisdictions/au.md. Suppression write confirmed.
  Compliance reply: not required for AU (suppression is sufficient; confirm
  with rules/jurisdictions/au.md if in doubt).

Close-out: complete. No further contact permitted for lisa@startup.test.
```

**Reply opt-out routed from reply-handling:**

```text
Routed from reply-handling: disposition = unsubscribe
Sender: marcus@bigco.example — open deal: BigCo AE Tooling
Message: "Thanks but I think we're going to pass. Please stop the emails."
Trigger phrase: "please stop the emails"

Step 1: Contact confirmed — marcus@bigco.example, Marcus Webb, BigCo.
         No sales reply drafted. Open deal flagged.

Step 2: crm-operator write:
  - Suppression flag: DNC + unsubscribed (set)
  - Removed from sequence "BigCo Expansion Q2" (1 active)
  - Open deal BigCo AE Tooling: note added "Marcus Webb opted out 2026-06-16.
    Deal status review required."
  - CRM task created: "[BigCo AE] Marcus opted out during active deal —
    review deal with manager before any further outreach strategy."

Step 3: Provenance record logged.
Step 4: Compliance reply: drafted (minimal factual acknowledgment — DRAFT, human
  review recommended given active deal context).

Note to rep: "Marcus opted out. The BigCo deal cannot proceed via email contact
with Marcus without fresh, documented consent. Discuss with manager."
```

**Verbal opt-out reported by rep:**

```text
Rep reports: "I was on the phone with Dana at co.example — she said 'don't contact
me again, I'm not interested.'"

Step 1: Contact: dana@co.example (rep confirms email address).
  Source: verbal / phone. Trigger: "don't contact me again."
  No sales reply (no channel to send one via — verbal channel).

Step 2: crm-operator write: suppression flag set, removed from all sequences.
Step 3: Provenance: opt_out_source = verbal/phone; trigger quoted as reported
  by rep; processed_at = ISO timestamp of this processing.
Step 4: Compliance reply: N/A (verbal channel). Suppression confirmed sufficient.

Note: verbal opt-outs carry the same weight as written ones. Record them the same way.
```

## Anti-patterns

- **Drafting a sales reply to an opt-out.** An opt-out is not a buying objection.
  It is a legal request. Do not draft "happy to help if you change your mind" or
  any commercial message in response. The only permissible reply is a factual
  compliance acknowledgment, where jurisdiction-required.
- **Treating "not interested" as a temporary objection.** If the contact's
  message includes a clear withdrawal signal, process it as an opt-out. Do not
  categorize it as `objection` and route to `objection-handling` to continue
  the conversation. When in doubt, suppress.
- **Suppression scoped to one sequence.** Suppression is global. Removing a
  contact from the current sequence while leaving them on others violates
  `outbound-compliance.md`. All sequences, all lists, all personas.
- **Recording without provenance.** A suppression note that says only "opted out"
  with no timestamp, no trigger phrase, and no source is not a defensible
  compliance record. Every field in the provenance record matters.
- **Re-adding a suppressed contact without consent.** A contact who opted out
  cannot be re-added to a sequence because they opened a new job at a new company,
  or because a different rep wants to try a different angle. Re-consent requires
  a fresh, documented basis — this skill does not handle that.
- **Delaying the suppression write.** The deadline clock starts from the moment
  of the request, not from when the rep notices it. Process immediately.
- **Writing the CRM directly.** All suppression writes route through
  `crm-operator`. This skill proposes and directs; `crm-operator` executes and
  confirms.

## Related

- `inbox-triage` — upstream router: classifies `opt_out_request` messages and
  routes here. Uses identical routing phrase.
- `reply-handling` — upstream router: classifies `unsubscribe` disposition
  replies and routes here. Uses identical routing phrase.
- `crm-operator` — sole write-capable agent; executes all suppression flags,
  list removals, contact notes, and CRM tasks.
- `rules/common/outbound-compliance.md` — owns the suppression, deadline, and
  unsubscribe requirements. Cite; do not restate.
- `rules/lawful-basis.md` — suppression always wins over any lawful basis.
- `rules/jurisdictions/au.md`, `rules/jurisdictions/us.md`,
  `rules/jurisdictions/eu-uk.md` — jurisdiction-specific deadline and
  confirmation requirements.
- `rules/jurisdiction-routing.md` — selects the correct overlay.
- No command — auto-trigger only.
