---
name: call-prep
description: >-
  Use before any customer or prospect meeting — discovery call, champion sync,
  executive briefing, QBR, or renewal — to produce a pre-meeting brief: confirmed
  attendees and their roles, account and deal history pulled from HubSpot first,
  the current MEDDPICC gaps to probe in this call (per the deal-review scoring),
  a stated meeting goal, and a structured talk track. Trigger on "prep for my
  call with X", "I have a meeting with Y tomorrow", "what should I ask in the
  discovery", "get me ready for the demo debrief", or any request to plan a
  customer-facing conversation before it happens.
origin: ESCC
---

# Call Prep

The pre-meeting brief. Before any customer or prospect call, ESCC builds a
compact, actionable dossier: who is in the room, what the account and deal
history says, which MEDDPICC elements are gaps to close in this call, what
winning looks like at the end of this meeting, and a talk track to get there.

> **Governing rule:** `rules/common/meeting-standards.md` — no customer
> meeting without prep. HubSpot is the system of record; account-researcher
> and deal-review surface the intel; stakeholder-mapping owns the role model.
> Do not fabricate account facts or product claims.

## When to Activate

Activate this skill when:

- A rep is preparing for any scheduled customer or prospect meeting and needs
  a structured brief: attendees + roles, context, gaps, goal, and talk track.
- "Prep me for my call with [Person / Account]" or similar is the request.
- A manager wants a deal-review coaching brief before a call review session.
- A new meeting is added to the calendar and automated prep is triggered.
- The rep asks "what should I focus on in this call" or "what are the gaps
  I need to close today."

Do **not** activate for meeting booking (that is `meeting-booking`) or for
post-call capture (that is `discovery-notes`). This skill runs before; those
run after.

Segment depth scales per `rules/segments/{enterprise,mid-market,smb}.md`:
enterprise prep includes full committee mapping and multi-stakeholder talk
tracks; SMB prep is a tighter one-page brief.

## Workflow

### 1. Identify the meeting and its attendees

- Confirm the meeting: date, time, type (discovery / demo / champion sync /
  exec briefing / renewal / QBR / other), and all confirmed attendees with
  their names and titles.
- For each attendee, identify their **role in the buying committee** via
  `stakeholder-mapping`. Mark any attendee whose role is unknown as a gap to
  resolve in the meeting.
- Note the selling-side attendees and their roles (AE, SE, CSM, exec sponsor).

### 2. Pull account and deal history — HubSpot first

- Use the `account-researcher` agent to retrieve the HubSpot account record:
  company overview, open and closed deals, last activity date, known contacts,
  and any notes or call log relevant to this meeting.
- Retrieve the deal record for the open opportunity (if one exists): stage,
  amount, close date, last stage-change date, and any activity logged since
  the last meeting.
- Label every fact from HubSpot as **[HubSpot]**. If account-researcher
  returns web-sourced intelligence (news, funding, tech stack), label it
  **[web]** and treat it as supporting context, not ground truth.
- If HubSpot and external sources disagree, HubSpot wins; flag the drift in
  the brief.

### 3. Surface the current MEDDPICC gaps

- Retrieve the current MEDDPICC scoring from `deal-review` (the rubric owner).
  Do not re-define the scoring scale here — cite the deal-review output.
- For each MEDDPICC element, record the current status as reported by
  deal-review: green / amber / red (per `deal-review`).
- Identify the **highest-priority gaps to close in this call** — typically
  the red and amber elements that gate the next stage advance.
- Map each gap to a probe question appropriate for this meeting type and the
  attendees in the room. A gap question for an end-user is different from the
  same gap directed at the economic buyer.

  | Element | Current status | Gap to probe | Target attendee |
  |---------|---------------|--------------|-----------------|
  | M — Metrics | ... | ... | ... |
  | E — Economic buyer | ... | ... | ... |
  | D — Decision criteria | ... | ... | ... |
  | D — Decision process | ... | ... | ... |
  | P — Paper process | ... | ... | ... |
  | I — Identify pain | ... | ... | ... |
  | C — Champion | ... | ... | ... |
  | C — Competition | ... | ... | ... |

### 4. State the meeting goal

- Write one sentence: what does a **winning outcome** look like at the end of
  this specific meeting?
- The goal must be concrete and binary — it either happened or it did not.
  Examples: "Leave with the economic buyer confirmed and a date for an exec
  intro", "Close the mutual-action-plan with agreed dates", "Get a verbal on
  preferred vendor."
- Avoid vague goals like "build rapport" or "move it forward" — these are not
  measurable outcomes per `meeting-standards`.

### 5. Build the talk track

- Open: confirm the agenda with the buyer and get their permission to take
  notes. State the time box.
- Situation set: one or two sentences on what you understand to be true — their
  context, what you last discussed, any change since — and ask them to correct
  or add.
- Gap probes: work through the priority gap questions from step 3. Sequence
  them from open (Identify pain, Metrics) toward specific (Decision process,
  Paper process) unless the meeting type dictates otherwise. Pre-load the
  Identify-pain probe with the approved role-keyed `pain` entry from
  `product-knowledge` (the attendee's role -> its known pain pattern) — a
  hypothesis to probe, not a stated fact; do not invent claims at prep time.
- Product moments: if a demo or proof point is appropriate, note where it lands
  in the flow and which claims to draw from `product-knowledge`. Do not invent
  claims at prep time.
- Close: the concrete next step you intend to ask for. Per `meeting-standards`,
  every open deal must leave a call with a dated next step.

### 6. Flag risks before the call

- Single-threaded (only one stakeholder in the room, economic buyer absent):
  flag and add a probe to identify who else needs to be part of the evaluation.
- Missing MEDDPICC elements that block the next stage advance: call them out
  explicitly so the rep prioritizes them.
- Competitor presence noted in prior calls or CRM notes: pull the relevant
  differentiation from `product-knowledge` if approved, or flag as a gap.

## Examples

**Discovery call — new prospect, minimal history:**

```text
/call-prep Acme Corp, 30-min discovery with Sarah Chen (VP RevOps), tomorrow

call-prep output:
MEETING: 2026-06-17 10:00 — Discovery / 30 min
ATTENDEES:
  - Sarah Chen, VP RevOps, Acme Corp [role in committee: likely economic
    buyer or key influencer — confirm in call]
  - [Your name], AE

ACCOUNT HISTORY [HubSpot]:
  - Account created 2026-06-10; source = inbound form (RevOps summit)
  - No open deals yet; no prior meetings logged
  - Notes: downloaded "forecast accuracy" whitepaper

DEAL HISTORY: No open deal — discovery intent call.

MEDDPICC GAPS (all red — first call):
  M: Unknown. Probe: "What does good look like for your forecast accuracy —
     is there a number you are trying to hit?"
  E: Unknown. Probe: "Who else gets pulled in when a new tool decision
     goes forward?"
  I: Partial (inbound intent signal — forecast accuracy). Probe: "What is
     the most painful part of your current forecasting process?"
  C: Unknown. Probe: (internal — note who is leaning in and sponsors
     a follow-up)
  [remaining fields red; will open in later calls]

MEETING GOAL:
  Leave knowing the quantified pain (M) and having confirmed or
  identified a path to the economic buyer (E); schedule a deeper
  discovery or demo as the dated next step.

TALK TRACK:
  Open: "Thanks for making time, Sarah. I have us for 30 minutes.
  My goal is to understand what you are trying to solve and make
  sure we are the right fit — does that work for you?"
  Situation: "You came in through the forecast accuracy content —
  can you tell me a bit about what prompted that search?"
  Gap probes: [M → I → E] as above
  Close: "This sounds worth a deeper look. Can we put 45 minutes
  on the calendar with you and whoever else would be involved in
  evaluating something like this?"

RISK FLAGS:
  - Single-threaded; economic buyer unknown — probe E in this call.
```

**Champion sync — mid-stage deal, known gaps:**

```text
/call-prep deal-id:DEAL-4421 with Jordan Kim (Sr. Director Finance)

call-prep output:
MEETING: 2026-06-18 14:00 — Champion sync / 45 min
ATTENDEES:
  - Jordan Kim, Sr. Director Finance [role: champion — confirmed per
    stakeholder-mapping update 2026-06-05]
  - [Your name], AE

ACCOUNT HISTORY [HubSpot]:
  - GlobalRetail Inc; 3 prior meetings; last activity 2026-06-10
  - Deal: DEAL-4421, "GlobalRetail — Forecast Platform — New"
    Stage: Solution Review | Amount: $48,000 | Close: 2026-07-31

MEDDPICC GAPS (per deal-review 2026-06-14):
  M: GREEN — "reduce month-end close reconciliation from 3 days to
     same-day" (Jordan, call 3)
  E: AMBER — CFO named (Dana Reeves) but not yet met
     Probe: "When we move to procurement, does Dana get involved
     directly or does her team handle it?"
  D (criteria): AMBER — cost and integration named; security posture
     not confirmed. Probe: "Has IT flagged anything specific on the
     security side we should be ready for?"
  D (process): AMBER — no procurement timeline confirmed.
     Probe: "What does the sign-off path look like once we align
     on a solution — is there a committee, or does Dana move
     unilaterally?"
  P: RED — paper process not started. Probe: "Do you work off a
     standard MSA or would you need us to redline our template?"
  C: GREEN — Jordan, confirmed champion per stakeholder-mapping
  C (competition): AMBER — incumbent spreadsheet-based process
     flagged; no external vendor named.

MEETING GOAL:
  Confirm the path to Dana (economic buyer E) and get a paper-process
  start date (P); leave with a mutual-action-plan step scheduled.

TALK TRACK: [continued per workflow step 5 ...]

RISK FLAGS:
  - Economic buyer (Dana) not yet met; deal at Solution Review —
    this is the stage gate. Jordan must facilitate the intro.
  - Paper process not started; close date is 2026-07-31 — 6 weeks
    with an unknown MSA cycle is a risk. Name it today.
```

## Anti-patterns

- **Skipping HubSpot and relying on memory.** Per `selling-principles`, HubSpot
  is the system of record. A prep brief built from memory is a prep brief built
  on drift. Pull the record; label what you find.
- **Inventing MEDDPICC status.** "Probably green" on Economic Buyer with no
  named person and no meeting logged is not green — it is red with happy ears.
  Use the deal-review output; do not override it with optimism.
- **A vague meeting goal.** "Have a good conversation" is not a goal. Write the
  specific, binary outcome the rep is driving to before the meeting starts.
- **Fabricating product claims in the talk track.** If a capability or proof
  point is in the talk track, it must come from `product-knowledge` (approved)
  or a prior tool-result. Plausible-sounding claims invented at prep time
  violate `selling-principles` §2.
- **Treating a prospect's website or third-party content as CRM fact.** Web
  intel is labeled [web] and treated as supporting context; it never overwrites
  a HubSpot record.
- **No next step in the talk track.** Every open deal leaves with a dated next
  step (`meeting-standards`). If the talk track ends without a close ask, the
  brief is incomplete.
- **Skipping stakeholder-mapping for a committee meeting.** If multiple buyer
  roles are attending, each needs a role assignment and tailored probe. A
  single generic talk track for a multi-stakeholder meeting is not prep.

## Related

- `deal-review` — owns the MEDDPICC red/amber/green scoring this skill reads.
- `stakeholder-mapping` — owns the buying-committee model; call-prep reads
  roles and champion status from it.
- `account-researcher` (agent) — retrieves HubSpot account + deal history.
- `discovery-notes` — the post-call counterpart; captures what was learned
  back into MEDDPICC fields via `crm-operator`.
- `demo-prep` — the equivalent brief for demo meetings; extends this skill's
  structure with a demo storyline and environment checklist.
- `rules/common/meeting-standards.md` — the prep/run/recap discipline this
  skill is the "prep" leg of.
- `rules/meddpicc/qualification.md` — the field definitions for the gap table.
- `rules/meddpicc/deal-review.md` — the scoring rubric this skill cites but
  does not own.
- `rules/segments/{enterprise,mid-market,smb}.md` — depth overrides for
  enterprise committee mapping vs. SMB one-pager.
