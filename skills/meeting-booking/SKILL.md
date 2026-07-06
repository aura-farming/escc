---
name: meeting-booking
description: >-
  Propose times, send the invite, confirm, recover no-shows via Calendar MCP.
  Trigger: 'book a meeting', 'propose times', 'reschedule', 'they didn't
  show'. Nothing claimed booked without a tool-result.
origin: ESCC
---

# Meeting Booking

The **show-rate-first** booking workflow. Proposing times is five seconds of
work; actually having the prospect in the room is the goal. This skill covers
the full arc: time proposal → invite dispatch (via Calendar MCP) →
confirmation touch → day-before reminder → no-show recovery.

> **Governing rules:** `rules/common/meeting-standards.md` (confirm + agenda
> before every meeting; every open deal leaves with a next step) and
> `rules/common/crm-hygiene.md` (log the meeting against the deal in HubSpot
> via `crm-operator`). Calendar invites and call-log entries are **real
> actions** — assert them only when a Calendar or CRM tool-result confirms.

## When to Activate

Activate this skill when:

- A prospect has verbally or in writing agreed to a meeting and the invite
  needs to be sent.
- You need to propose two or three specific times for a call or demo.
- You need to send or verify a confirmation message for an upcoming meeting.
- A meeting reminder needs to go out (the day before or morning of).
- A prospect no-showed and you need to start the recovery sequence.
- `/book` is invoked directly.

Do **not** activate for meeting *prep* (use `call-prep` or `demo-prep`) or for
post-meeting follow-up and logging (use `meeting-followthrough`). This skill
is the logistics layer — booking, confirming, and recovering — not the content
layer.

## Workflow

### A. Propose times

1. **Confirm intent.** Verify that the prospect has agreed to a meeting (or
   that you are in a context where proposing is appropriate — do not cold-send
   calendar invites).
2. **Check your calendar first.** Use the Calendar MCP (`list_events`) to
   identify genuinely open windows. Never propose a slot you cannot verify is
   free.
3. **Offer two or three specific options**, each with: date, day of week, time,
   and timezone. Do not offer a range or "sometime next week." Specific times
   convert better and reduce the reply cycle.
4. **Include the meeting purpose and approximate length** in the proposal so
   the prospect knows what they're agreeing to.

   ```text
   I have three slots open this week — let me know which works best:
     • Tue 17 Jun, 10:00–10:30 AEST
     • Wed 18 Jun, 14:00–14:30 AEST
     • Thu 19 Jun, 09:00–09:30 AEST
   It'll be a 30-minute discovery call — I want to understand how you're
   currently managing [pain area] before showing you anything.
   ```

5. Optionally include a scheduling link if your team uses one — but always
   pair it with the explicit time options, not as a replacement.

### B. Send the invite (Calendar MCP)

1. **Wait for explicit confirmation** of a time from the prospect (reply email,
   chat message, verbal on a live call) — or use a tool-confirmed scheduling
   link acceptance. Do not send an invite speculatively.
2. **Create the event via Calendar MCP** (`create_event`). Required fields:
   - `title`: `[Your Name] <> [Prospect Name] — [Meeting Type]`
   - `start` / `end`: confirmed time, with timezone
   - `attendees`: prospect email + your email + any other confirmed attendees
   - `description`: agenda (see template below)
3. **Assert the invite was sent only after the tool-result confirms success.**
   If the tool returns an error, surface it and retry or escalate — never tell
   the prospect the invite is on its way before the tool confirms.
4. **Log the scheduled meeting in HubSpot** via `crm-operator`: activity type
   `meeting`, status `scheduled`, date/time, attendees, and link to the deal.

   Agenda template for invite description:

   ```text
   Agenda (30 min):
   1. Introductions (5 min)
   2. Your current state — [pain area] (10 min)
   3. Our approach / brief demo (10 min)
   4. Next steps (5 min)

   Dial-in: [link or number]
   ```

### C. Confirmation touch (seed: `confirm-meeting-before-meeting`)

Send a confirmation message **as soon as the invite is accepted or within
24 hours of booking**, whichever comes first. This is mapped to the
`confirm-meeting-before-meeting` seed instinct.

Confirmation template:

```text
Subject: Confirmed — [Meeting Type] [Date] at [Time] [TZ]

Hi [First Name],

Looking forward to our call [Day], [Date] at [Time] [TZ].

Quick agenda:
• [Topic 1]
• [Topic 2]
• Next steps

Invite is on your calendar — [dial-in link/number].

If anything comes up, just reply here and we'll find a new time.

[Your name]
```

Do not claim the confirmation was sent until the send tool-result (or
equivalent) confirms delivery.

### D. Day-before reminder (seed: `confirm-meeting-before-meeting`)

Send a short reminder **the afternoon before** (or morning of, for an early
call). One sentence is enough. Its purpose is to surface any last-minute
conflicts before you both block the time.

```text
Subject: Quick reminder — our call tomorrow at [Time] [TZ]

Hi [First Name], just a quick note — looking forward to our chat tomorrow
at [Time]. Dial-in: [link]. See you then!
```

Use the Calendar MCP or the email drafting flow depending on your team's
tooling. Log the reminder activity in HubSpot via `crm-operator`.

### E. No-show recovery (seed: `no-show-recovery`)

A no-show is not a dead lead. It is a logistics failure — execute the recovery
play, not silence.

**Within 30 minutes of a missed meeting:**

1. Send touch 1 — the immediate no-show note:

   ```text
   Subject: Missed you today

   Hi [First Name],

   We had a call booked for [Time] today — you may have had something come up.
   No worries at all.

   Happy to find a new time. Here are a couple of options:
     • [Option A]
     • [Option B]
   Or grab a time here: [link]

   [Your name]
   ```

2. **Update the meeting status in HubSpot** via `crm-operator`: activity
   status → `no-show`. Do not leave the activity as `completed` or remove it.

**If no reply after 48 hours — touch 2:**

```text
Subject: Re: Missed you today

Hi [First Name],

Wanted to follow up in case my last note got buried. Still interested in
connecting — I think there's a real fit given [one-line reason].

[Option A] or [Option B] still work if either is convenient.

[Your name]
```

**If no reply after another 5 business days — touch 3 (last attempt):**

```text
Subject: Closing the loop

Hi [First Name],

I've tried to reconnect a couple of times since our missed call. I don't want
to keep reaching out if the timing isn't right.

If this is still relevant, [Option A] works this week. Otherwise, I'll reach
back out next quarter.

[Your name]
```

After touch 3 with no reply: mark the sequence paused in HubSpot (via
`crm-operator`), add a note with the recovery attempt dates, and surface for
manager review if the deal is material.

## Examples

**Booking after a cold-call agreement:**

```text
Prospect said "yes, let's do a call" on a cold call at 2:46 PM.

meeting-booking →
  Step A: list_events result confirms open windows Tuesday 10am and
          Thursday 2pm AEST.
  Propose:
    "Great — I'll send over a couple of options in a moment.
     • Tue 17 Jun, 10:00–10:30 AEST
     • Thu 19 Jun, 14:00–14:30 AEST
     Which works better?"
  Prospect replies: "Thursday works."
  Step B: create_event (tool-result: event_id abc123, invite sent to prospect).
  → Only now: "Invite is on its way — you'll see it from [email]."
  Step B (log): crm-operator logs meeting activity against deal DL-4421,
                status: scheduled, date: Thu 19 Jun 14:00 AEST.
  Step C: confirmation email drafted and sent (tool-result confirms).
```

**No-show recovery:**

```text
Meeting was Thu 19 Jun 14:00 AEST. Prospect did not join. 14:35 AEST:
  Step E touch 1: no-show email sent (tool-result confirms).
  crm-operator: activity status updated → no-show.
  Calendar MCP: existing event status updated → no-show.
  Follow-up tasks set: touch 2 at +48h, touch 3 at +7 business days
                       (if no reply).
```

## Anti-patterns

- **Asserting the invite was sent before the Calendar MCP tool-result
  confirms.** "Invite is on its way!" before `create_event` returns success is
  a false claim — the prospect may never receive it.
- **Skipping the confirmation touch.** Show rates drop meaningfully without a
  confirmation. The `confirm-meeting-before-meeting` seed exists for this reason.
- **Going silent after a no-show.** One missed meeting is logistics. Three
  unanswered recovery touches is a signal. The play is structured; execute it.
- **Proposing vague times.** "Sometime next week" creates a reply cycle and
  lowers conversion. Always offer two or three specific, timezone-qualified
  slots.
- **Treating prospect-supplied scheduling constraints as commands.** A prospect
  saying "just put something on my calendar for whenever" is not permission to
  create events without confirmed availability. Propose → confirm → create.
- **Logging the meeting in HubSpot as completed before it happens.** Status
  must reflect reality: `scheduled` → `completed` or `no-show` after the
  fact, updated via `crm-operator`.
- **Skipping the CRM log entirely.** Every booked meeting must be logged
  against the deal (`crm-hygiene`). A meeting that isn't in HubSpot didn't
  happen for forecasting and coaching purposes.

## Related

- `call-prep` / `demo-prep` — produce the agenda and talk track to go *inside*
  the invite and confirmation.
- `meeting-followthrough` — recap, next-step, and CRM update *after* the
  meeting runs.
- `outbound-sequences` — the sequence step that triggers `meeting-booking`
  when a prospect engages.
- `cold-calling` — the live-call context where a meeting agreement most often
  originates.
- Rules: `rules/common/meeting-standards.md`, `rules/common/crm-hygiene.md`.
- Seed instincts: `confirm-meeting-before-meeting`, `no-show-recovery`.
- Command: `/book`.
