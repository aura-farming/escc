---
name: outbound-sequences
description: >-
  Use when building, launching, or auditing a multi-touch outbound cadence
  across email, LinkedIn, phone/voicemail, or any combination — including
  standard SDR cadences, event-triggered sequences, and ABM account plays.
  Trigger on "build me a sequence", "set up a cadence for <segment>", "what
  should the touchpoints look like", "enroll <contact> in a sequence", or
  whenever a rep needs a compliant, multi-step outreach plan ready for
  outbound-reviewer before the send gate.
origin: ESCC
---

# Outbound Sequences

The multi-touch cadence engine. This skill assembles compliant, channel-mixed
sequences — email, LinkedIn, call, and voicemail — pulling structure from
`playbook-library`, approved proof from `product-knowledge`, and voice from
`brand-voice`. Every sequence produced here is **draft-only**; no step is live
until it passes `outbound-reviewer` and clears the fail-closed
`pre:outbound-send-gate` hook.

> **Governing rules:** `rules/common/outbound-compliance.md` (unsubscribe +
> sender identity on every commercial email, suppression check before enroll),
> `rules/common/messaging-style.md` (one CTA, < 120-word emails, no soft
> closes), `rules/common/selling-principles.md` (evidence-first, no fabricated
> claims, no false completion).

## When to Activate

Activate this skill when:

- An SDR needs a **complete multi-touch cadence** for a segment, persona, or
  named account — standard, event-triggered, or ABM variant.
- A rep asks to **enroll a contact** in a sequence (suppression check first,
  then build or select the appropriate sequence).
- A sequence needs an **audit or refresh** — checking for stale proof points,
  compliance gaps, or low-response steps.
- `outreach-analytics` signals that a step is underperforming and a **variant**
  needs to be drafted and swapped in.

Do **not** activate for a single first-touch only (use `cold-outreach` for
that). Do not activate to log or track sequence enrollment — use `crm-operator`
for enrollment logging.

## Default Cadence Structure

The baseline SDR cadence is **7 touches over ~12 days** across three channels.
Deviate with reason; document it in the sequence header.

| Step | Day | Channel | Goal |
|---|---|---|---|
| 1 | 0 | Email | First touch — personalized opener, value hook, CTA |
| 2 | 1 | LinkedIn | Connection request or InMail — short, no pitch yet |
| 3 | 4–5 | Email | Follow-up — new angle or proof point, same CTA |
| 4 | 5 | Call | Live dial — 30-second value framing, ask for 15 min |
| 5 | 5 | Voicemail | 20–25 seconds if no answer — reference email, one clear ask |
| 6 | 10–12 | Email | Break-up / pattern-interrupt — reframe or different persona |
| 7 | 12 | LinkedIn | Soft engagement (comment, share) or final InMail |

**Day 0** is enrollment day. Steps 4 and 5 are same-day (call first, leave VM
if no answer). Email body limits: < 120 words per `messaging-style`.

### Event-Triggered Variant

Compress the cadence when a relevant trigger fires (funding round, job change,
product launch, conference attendance, intent signal). Reduce to 4–5 touches
over 7 days; lead with the trigger in step 1.

| Step | Day | Channel | Note |
|---|---|---|---|
| 1 | 0 | Email | Trigger-led opener ("saw your Series B announcement…") |
| 2 | 1 | LinkedIn | Connection + one-line relevance ref |
| 3 | 3–4 | Email | Proof point + CTA |
| 4 | 4 | Call + VM | Live attempt |
| 5 | 7 | Email | Break-up |

### ABM Variant

For a named account with multiple stakeholders, build **per-persona threads**
(Champion, Economic Buyer, Blocker) that run in parallel and reference each
other. Coordinate timing so the same account does not receive three emails
from three reps on the same day. Each thread still follows the compliance and
CTA rules below.

## Workflow

### Step 1 — Suppression check (MANDATORY before enroll)

Before adding any contact:

1. Call `crm-operator` (read) to check the contact against the suppression
   list (prior opt-out, DNC, hard bounce, complaint, or legal hold).
2. If suppressed: **stop** — do not enroll, do not contact. Log the block.
3. If clean: proceed to sequence selection or build.

This is not optional. `post:outbound-style-check` audits enrollments
retroactively; a suppressed contact in a sequence is a compliance violation.

### Step 2 — Sequence selection or build

1. Check `playbook-library` for an approved sequence template matching the
   segment + persona + product motion. If a match exists, start there.
2. If no template: build from the default cadence structure above, selecting
   the appropriate variant (standard / event-triggered / ABM).
3. Pull **value props and proof points** from `product-knowledge` via its specificity
   ladder — **role + segment + competitor** (the contact's role resolves from `jobtitle`),
   approved entries only, with provenance. If no approved proof exists for the slot,
   soften to a question; do not invent a metric.
4. Apply **voice and phrasing** from `brand-voice`. Do not invent a new tone.

### Step 3 — Draft each step

For every step, define:

- **Channel** (email / LinkedIn / call script / voicemail script)
- **Timing** (day relative to enrollment)
- **Goal** (what outcome this step is driving toward)
- **Draft content** (full copy — see format requirements per channel below)
- **Compliance block** (email: unsubscribe + sender identity, every time)

#### Email step format requirements

```
Subject: [< 50 chars, honest, no clickbait]
Body: [< 120 words, one idea, CTA last]

---
[Unsubscribe link — mandatory on every commercial email]
[Sender full name, title, company]
[Physical/postal business address]
```

No email step ships without the unsubscribe + sender-identity block. This is
enforced by `post:outbound-style-check` and required by
`outbound-compliance.md`.

#### Call script format (30 seconds)

```
Opening: "[Name], this is [Rep] from [Company] — is this an ok time for 30 seconds?"
Value: "[One sentence on the specific pain or trigger you saw.]"
Ask: "I'd love 15 minutes to show you how [outcome]. Worth a quick chat this week?"
Objection pocket: [One prepared response to "send me an email" or "not interested"]
```

#### Voicemail script format (≤ 25 seconds)

```
"Hey [Name], [Rep] at [Company]. [One-line trigger reference.] Left you an email —
subject is [subject line]. If it's relevant, I'm at [number]. No worries if not."
```

Never leave a voicemail pitching the full product. Reference the email; keep
it < 25 seconds.

#### LinkedIn step format

- Connection request: < 200 chars, no pitch, one-line relevance.
- InMail: < 150 words, same structural rules as email minus the compliance
  block (LinkedIn's own unsubscribe mechanism applies); still requires accurate
  sender identity and no fabricated claims.

### Step 4 — Compliance review of every email step

Before the sequence is considered ready for `outbound-reviewer`:

- [ ] Unsubscribe link present on every commercial email step
- [ ] Sender full name, company, and physical address present on every email
- [ ] No fabricated metrics — every number traces to an approved
      `product-knowledge` entry with provenance
- [ ] No deceptive subject lines
- [ ] One CTA per email step, no stacked asks
- [ ] Each step adds a new angle or value — no re-pitch in different words

### Step 5 — Hand to `outbound-reviewer`

Pass the full sequence draft. `outbound-reviewer` checks confidence across
compliance, claim accuracy, and tone before it is eligible for the send gate.
A sequence is draft-only until `outbound-reviewer` clears it **and** a human
approves the live send (recorded in the state store).

### Step 6 — Enroll via `crm-operator`

Once approved:

1. `crm-operator` logs the enrollment event in HubSpot against the contact
   record — sequence name, start date, step count.
2. Bulk enrollments (> 1 contact) require a review pack and are capped by
   `ESCC_BULK_SEND_MAX`.
3. Track variant performance in `outreach-analytics`; use that data to retire
   underperforming steps and promote winners.

## Examples

**Standard sequence — RevOps persona, mid-market:**

```text
SEQUENCE: RevOps Mid-Market / Q3 Forecast Pain / 7-step
Enrolled: 2026-06-16 | Suppression check: CLEAN

Step 1 — Day 0 | Email
Subject: Forecast accuracy for {company}

Hi {first_name},

RevOps teams at companies like yours spend the last week of every quarter
manually reconciling pipeline because reps update CRM inconsistently.

Our customers close that gap in under a day — first clean forecast typically
happens on day one after setup, going off our onboarding data.

Worth 15 minutes to see if the problem looks similar here?

{Rep first name}
{Title} | {Company}
{Physical address}
Unsubscribe: {link}

---
COMPLIANCE: ✓ unsubscribe ✓ sender identity
PROOF: product-knowledge PP-031 (approved, verified 2026-05-02)
ANGLE: forecast pain — day-one time-to-value

Step 2 — Day 1 | LinkedIn
Request note (< 200 chars):
"Hi {first_name} — work with RevOps teams on forecast accuracy.
Saw you're at {company}; thought it worth connecting."

---
Step 3 — Day 4–5 | Email
Subject: How {similar_company_type} handles late-quarter reconciliation

Hi {first_name},

One thing that surprises RevOps teams: the reconciliation problem is almost
always a CRM hygiene issue, not a forecasting tool issue.

Happy to share how other teams have approached it — 15 minutes this week?

{Rep first name}
{Title} | {Company}
{Physical address}
Unsubscribe: {link}

---
COMPLIANCE: ✓ unsubscribe ✓ sender identity
PROOF: no specific metric used — framed as pattern, not stat
ANGLE: reframe root cause

Step 4 — Day 5 | Call script (30 sec)
"Hi {first_name}, this is {Rep} from {Company} — 30 seconds ok?
Sent you a note about forecast reconciliation for RevOps teams.
We help teams like yours get a clean forecast on day one — I'd love 15 minutes
to show you how. Anything on your calendar this week?"

Step 5 — Day 5 | Voicemail (≤ 25 sec, if no answer)
"Hey {first_name}, {Rep} at {Company}. Left you an email — subject is
'How {similar_company_type} handles late-quarter reconciliation.' If that's a
live problem, I'm at {number}. No worries if not."

Step 6 — Day 10–12 | Email (break-up)
Subject: Closing the loop

Hi {first_name},

I'll stop reaching out — clearly the timing isn't right.
If late-quarter pipeline chaos becomes a priority, you know where to find us.

{Rep first name}
{Title} | {Company}
{Physical address}
Unsubscribe: {link}

---
COMPLIANCE: ✓ unsubscribe ✓ sender identity

Step 7 — Day 12 | LinkedIn
Engage with a recent post (like or comment) or send a final InMail:
"Closing the loop — happy to revisit if forecast accuracy lands on the radar."
```

**Suppression block example:**

```text
Requested: enroll contact@prospect.com in RevOps Mid-Market sequence.

Suppression check → BLOCKED.
Reason: prior opt-out logged 2026-04-12 via email unsubscribe.

Action: contact not enrolled. Event logged in HubSpot (crm-operator).
Do not re-add to any sequence. Do not attempt manual outreach.
```

**Outreach-analytics-driven step retirement:**

```text
outreach-analytics reports: Step 3 (Day 4 email) reply rate 0.8% over 90-day
window — below 2% threshold.

Retiring Step 3 body. Drafting variant:
  ANGLE: Peer comparison ("what your counterparts at similar companies told us")
  PROOF: product-knowledge — pull approved social-proof entry, if available.
  If none: frame as question, not a claim.

Variant drafted → hand to outbound-reviewer before promoting to live sequence.
```

## Anti-patterns

- **Skipping the suppression check.** Adding a suppressed contact is a
  compliance violation. The check is non-optional, every time, before any
  enrollment.
- **Missing the compliance block on any email step.** One step without an
  unsubscribe link fails the whole sequence. `post:outbound-style-check`
  will catch it, but do not rely on the hook to find what you should have
  included.
- **Inventing a metric to make step 1 land.** A specific number with no
  approved `product-knowledge` entry is fabrication. Soften to a question or
  a framed pattern; never invent a stat.
- **Re-pitching the same angle.** Each step must add a new angle, reframe, or
  proof point. "Just following up" with the same body is a soft-close
  anti-pattern (`messaging-style.md` explicitly bans it) and will be flagged
  by `outbound-reviewer`.
- **Claiming the sequence is live.** A sequence is a draft until
  `outbound-reviewer` clears it and a human approves the live send. Do not
  report it as enrolled or sending until `crm-operator` logs the tool-result
  confirmation.
- **Stacking CTAs.** One ask per touch. "We could also jump on a call, or
  maybe you'd prefer a demo, or I could send a one-pager" is three asks and
  guarantees zero action.
- **Ignoring outreach-analytics signals.** If a step is persistently below
  the reply-rate threshold, retire it. Running a known-bad step because "it
  might still work" wastes send quota and degrades domain health.

## Related

- `cold-outreach` — first-touch personalization workflow; feeds step 1 of this
  skill.
- `playbook-library` — approved sequence templates; check here before building
  from scratch.
- `product-knowledge` — source of all approved proof points; never fabricate.
- `brand-voice` — sets tone and phrasing for all copy.
- `outbound-reviewer` — must clear every sequence before the send gate.
- `outreach-analytics` — reply-rate and conversion data; drives step retirement
  and variant promotion.
- `crm-operator` — the sole write-capable agent; logs all enrollments and
  activity.
- `opt-out-handling` — processes unsubscribe requests and updates suppression.
- `rules/common/outbound-compliance.md` — the legal/regulatory floor.
- `rules/common/messaging-style.md` — structural bar for all outbound copy.
- Command: `/sequence`.
