---
name: brand-voice
description: >-
  Build a rep writing-style profile from real sent messages. Trigger: 'doesn't
  sound like me', 'set up my voice', new-rep baselining. Produces the VOICE
  PROFILE all drafting skills consume. Auto-triggers.
origin: ECC-adapted
---

# Brand Voice

_Adapted from ECC's `brand-voice` (MIT, (c) Affaan Mustafa). See LICENSE._

Build a durable `[VOICE PROFILE]` from real source material -- real messages
that got replies, real openers that landed meetings -- then reuse that profile
across every drafting skill instead of re-deriving style or defaulting to
generic AI sales copy.

This skill **owns the VOICE PROFILE format**. Every drafting skill that needs
voice consistency cites `[VOICE PROFILE]` and reads the output this skill
produces. Defining a competing voice structure anywhere else is an anti-pattern.

> **Governing rule:** `rules/common/selling-principles.md` -- voice is a
> style overlay, never a license to fabricate claims or misrepresent the sender.
> A profile captures *how* to say things; what to say is governed by
> `product-knowledge` and the deal context.

## When to Activate

Activate this skill when:

- A rep wants drafts that sound like them, not like a template.
- A cold-outreach or follow-up skill is producing copy the rep won't send.
- Onboarding a new rep: capturing their writing style before they have AI
  assistance in their workflow.
- Moving to a new channel (LinkedIn DM vs. email vs. cold-call opener) and the
  per-channel voice notes need to be established or updated.
- A manager wants a consistent team voice for a new segment play.
- The existing profile is stale (>90 days) and a refresh sample exists.

Do **not** activate to make generic copy "sound less generic" by adjusting
one or two surface words. If the problem is that a draft is too long or too
formal, that is a revision task, not a voice-profile task. If the draft is
fabricating claims, fix the claim source -- the voice layer cannot fix that.

## Source Priority

Use the strongest real source set available, in this order:

1. Sent emails that got a positive reply (booked meeting, continued thread,
   warm response). These are the highest signal -- they worked.
2. Cold call openers and voicemail scripts the rep actually uses.
3. LinkedIn connection requests or DM sequences the rep wrote themselves.
4. Meeting recap or follow-up notes the rep sends after discovery calls.
5. If the rep has no usable sample: manager-supplied exemplar emails from
   a teammate whose style fits the segment.

Do **not** use generic sales email templates, training library examples, or
any content the rep did not author or explicitly endorse as "my voice". The
profile is a fingerprint, not a persona assigned from the outside.

Minimum sample: 5 messages. Ideal: 10-20. More than 20 adds diminishing
returns unless the rep writes in clearly different modes for different segments.

## Collection Workflow

1. **Gather the source set.** Ask the rep to paste or attach 5-20 real sent
   messages. If pulling from an email export, use only the rep's own sent
   side of threads -- not the prospect's replies.
2. **Separate by mode if needed.** If the sample clearly splits into "first
   touch cold" vs. "warm follow-up" vs. "post-demo check-in", note the split
   in the profile rather than averaging them into a single mush.
3. **Extract the signal fields below.** Work field by field; do not summarize
   the whole batch into one vague paragraph.
4. **Produce the `[VOICE PROFILE]` block** using the canonical format defined
   in this skill (see "Voice Profile Format" section below).
5. **Confirm with the rep.** Read back the Banned Moves and Preferred Moves
   lists specifically -- those are the easiest to get wrong and the most
   important to get right.

## What to Extract

For each source sample, note the following signal dimensions:

- **Sentence length and rhythm:** Short and punchy? Long and explanatory?
  Mixed? Does it fragment intentionally?
- **Compression:** Dense (every sentence adds new information) or
  explanatory (context given before claims)?
- **Opening move:** Does the rep open with the prospect ("You just...")?
  With themselves ("I'm...")?  With a question? With a fact?
- **Personalization style:** Research-led specificity, or pattern-matched
  persona assumption? How many lines before the rep gets to the point?
- **Question use:** How many questions per message? Are they rhetorical,
  direct, or hypothetical? Does the rep use a question to close?
- **Claim style:** Are claims backed with a number or reference immediately,
  or stated and left to imply? How sharply are comparisons drawn?
- **CTA pattern:** Single ask or multiple? Soft ("worth a chat?") or direct
  ("15 min Thursday 2pm or Friday 10am -- which works?")? Does the rep
  offer a low-commitment step first?
- **Sign-off:** Formal (Best regards), minimal (one word + name), or dropped
  entirely?
- **Channel-specific norms:** What the rep does differently in LinkedIn vs.
  email vs. voicemail.

## Voice Profile Format

Produce a `[VOICE PROFILE]` block using this exact structure. Keep bullets
concrete -- short phrases, not essays. Every Banned Move must be observable
in the source set or explicitly requested; do not add bans speculatively.

```text
[VOICE PROFILE]
===============
Rep:
Segment focus:
Confidence: high / medium / low (based on sample size and consistency)
Sample count:
Last updated:

Source Set
- <description of source 1, e.g. "6 cold emails, SaaS AE targets, Q1 2026">
- <description of source 2>
- <note any mode splits, e.g. "cold vs. warm voice differ -- see Channel Notes">

Rhythm
- <sentence length and pacing: e.g. "short sentences, 1-2 per paragraph, no filler">

Compression
- <density: e.g. "high -- one idea per sentence, no lead-in context before the claim">

Opening Move
- <how the rep opens: e.g. "prospect-first: names the trigger before anything else">

Personalization Style
- <e.g. "one concrete research line max, then the pivot; does not pad with flattery">

Question Use
- <frequency and type: e.g. "one question per message max, always at the end, direct ask">

Claim Style
- <e.g. "number or reference within the same sentence as the claim; no bare adjectives">

Preferred Moves
- <move 1: e.g. "names the trigger in line one">
- <move 2>
- <move 3>

Banned Moves
- <ban 1: e.g. "no 'I hope this finds you well' or any variant">
- <ban 2>

CTA Pattern
- <e.g. "single ask, specific times offered, 'worth a chat?' as the minimal variant">

Sign-off
- <e.g. "first name only, no 'Best' or 'Thanks'">

Channel Notes
- Email: <what changes in email vs. baseline>
- LinkedIn: <e.g. "shorter; no formal sign-off; opener is one line max">
- Cold call opener: <e.g. "lead with the trigger; permission ask within first 10 seconds">
```

## Hard Bans (Sales-Context Defaults)

These are banned regardless of the rep's personal sample, because they are
statistically low-reply patterns. A rep's profile can override any item in this
list only if the rep's source set shows they work in their specific book of business
and the rep explicitly confirms them.

- "I hope this email finds you well" or any variant ("Hope you're doing great",
  "Trust all is well with you").
- "I wanted to reach out" -- start with the reason, not the meta-statement.
- "Just following up" as an opener -- say what changed or why now.
- Manufactured flattery ("Love what you're doing at [Company]" with no
  specific detail).
- The feature-dump opener (listing three things the product does before
  saying anything about the prospect).
- Passive CTA ("Let me know if you're interested" / "Feel free to reach out").
- Stacked asks (more than one request in a single message).
- "Excited to connect" or "Would love to chat" without a concrete agenda.
- All-caps emphasis used as a substitute for a sharp claim.
- Generic P.S. lines ("P.S. Here is a case study you might find relevant").

## Persistence Rules

- Reuse the latest confirmed `[VOICE PROFILE]` across related tasks in the
  same session without re-deriving it.
- If a rep requests a durable artifact, save the profile to
  `.claude/escc/voice/<rep-slug>.md` (workspace-local; never committed
  with personal data unless the rep explicitly requests repo tracking).
- For a durable *per-account* style overlay (how a specific account writes, to
  layer on top of the rep base profile), see "Per-Account Voice Overlay" below —
  stored at `.claude/escc/voice/account/<account>.md`.
- If the drafting skill is `cold-outreach`, `outbound-sequences`,
  `follow-up-ops`, `reply-handling`, `email-outbound-ops`,
  `meeting-followthrough`, or `inbox-triage`, check whether a session-local
  `[VOICE PROFILE]` already exists before starting a new collection.
- Do not store voice profiles in HubSpot records. They are a local
  style artifact, not a CRM field.

## Per-Account Voice Overlay

A `[VOICE PROFILE]` captures how the *rep* writes. A **per-account voice
overlay** captures how a specific *account* writes, so a draft to that account
mirrors their register and vocabulary on top of the rep's base profile.

**Contract for consumers.** Every voice-consuming skill (`cold-outreach`,
`outbound-sequences`, `follow-up-ops`, `reply-handling`, `email-outbound-ops`,
`meeting-followthrough`, `inbox-triage`) layers this overlay on the rep base
profile whenever it drafts to a *known account with prior correspondence*: load
it with `escc voice show "<account>"`. The overlay only adjusts register and
word choice — the rep base profile still wins on Banned/Preferred Moves, and
facts still come only from approved `product-knowledge`.

- **Storage:** `.claude/escc/voice/account/<account>.md` (gitignored — it is
  mined from real correspondence and never belongs in the source repo). It
  *layers on* the rep base profile at `.claude/escc/voice/<rep-slug>.md`; it
  never replaces it.
- **A draft is:** rep base voice × buyer-role register × this-account register ×
  the account's mirrored lexicon. The base profile still wins on the rep's own
  Banned Moves and Preferred Moves; the overlay only nudges register (formality,
  sentence length, question rate, greeting/sign-off) and word choice toward this
  account.
- **Build or refresh it deterministically** with
  `escc voice account "<account>" --input '{"texts":[...]}'`, then read it back
  with `escc voice show "<account>"`. The extractor is no-ML and deterministic —
  it does not "interpret" the account, it tallies observable style.
- **Buyer side only, via quarantine.** The `texts` are the *buyer's* words — the
  emails they sent you and their turns in a call transcript — gathered through
  the read-only quarantine/thread path (`transcript-analyzer`,
  `email-outbound-ops`), never the rep's own sent copy. Raw bytes never reach a
  privileged context.

> **The style/content split is enforced here, not just stated.** The overlay
> mirrors the buyer's **words**, never their **claims or numbers**. The lexicon
> is pure-alphabetic terms only — a metric, a percentage, or a currency figure
> can never become a term, and a source sentence is never echoed into the
> overlay. You may sound like the account; you may **never** repeat their figure
> back as if it were our proof. Facts and metrics come only from approved
> `product-knowledge`. (Enforced by `scripts/lib/account-register.js` +
> `scripts/lib/voice-overlay.js`, pinned by
> `tests/unit/content-guard-lexicon-leak.test.js`.)

## Examples

**Profile built from 8 cold emails:**

```text
[VOICE PROFILE]
===============
Rep: A. Patel
Segment focus: SaaS mid-market RevOps
Confidence: high
Sample count: 8 sent emails with positive reply
Last updated: 2026-06-16

Source Set
- 8 cold emails to RevOps Directors, sent Q4 2025 - Q1 2026, all had positive reply
  or booked meeting

Rhythm
- 1-2 sentences per paragraph; no paragraph over 3 lines; deliberately fragmented
  for scannability

Compression
- high; no contextual preamble before the claim; no "as you may know" framing

Opening Move
- always leads with a specific company or persona observation within the first line
  (trigger, role change, or segment-specific assumption)

Personalization Style
- one research line tied to a real signal (job post, announcement, funding); moves
  to the pivot immediately; never pads

Question Use
- one per message, at the end; always a direct yes/no or specific time ask

Claim Style
- cites a reference or number in the same sentence; never bare adjectives
  ("fast" or "better"); always "X faster" or "teams like yours report Y"

Preferred Moves
- Opens with prospect's situation, not own product
- Lands the value in one short sentence before the CTA
- Uses one concrete proof point from product-knowledge, attributed correctly

Banned Moves
- "I hope this finds you well" or any greeting filler
- "I wanted to reach out" as an opener
- Feature-dump before the prospect hook
- Stacked asks

CTA Pattern
- single ask; offers two specific time slots; "worth a 15?" as the minimum variant

Sign-off
- first name only

Channel Notes
- Email: baseline above
- LinkedIn: opener compressed to one line; no sign-off; uses "open to it?" as CTA
- Cold call opener: trigger first ("I saw you just posted for a Revenue Ops
  Director -- that usually means..."); permission ask by second sentence
```

**When a drafting skill should cite the profile:**

```text
cold-outreach: building first-touch email for A. Patel -> GlobalBank RevOps VP
brand-voice: [VOICE PROFILE] loaded (A. Patel, confirmed 2026-06-16)
cold-outreach: applying profile --
  - opener: GlobalBank just raised Series C; leading with funding trigger
  - compression: high; claim in line two
  - one proof point from product-knowledge PP-031 (onboarding velocity)
  - CTA: "worth a 15 this week?" -- no stacked ask, specific times in follow-up
  - sign-off: "A." only
```

## Anti-patterns

- **Ignoring the source set and generating a profile from scratch.** A
  profile must be sourced from real material. If no sample exists, say so
  and ask for one; do not invent a representative style.
- **Averaging a split voice into one profile.** If the rep writes very
  differently for cold vs. warm, document two modes; do not blend them.
- **Adding bans speculatively.** Only ban what is observable in the source
  set or what the rep explicitly requests. Unsourced bans create a profile
  that does not actually reflect the rep.
- **Using the voice profile to excuse fabricated claims.** Voice is how you
  say it. What you say is governed by `product-knowledge`. The profile does
  not override the evidence-first requirement.
- **Storing the profile in HubSpot or in a shared CRM field.** Voice
  profiles are personal writing fingerprints; they belong in the local
  workspace, not in the system of record.
- **Re-deriving style on every draft.** Build the profile once, then cite
  it. Do not produce slightly different voice analysis on each message -- that
  defeats the purpose of a durable profile.
- **Applying the profile to a different rep's outreach without confirmation.**
  A profile is rep-specific. Do not reuse A. Patel's profile for K. Lee's
  messages without explicit approval and confirmation.

## Related

- Feeds: `cold-outreach`, `outbound-sequences`, `follow-up-ops`,
  `reply-handling`, `email-outbound-ops`, `meeting-followthrough`,
  `inbox-triage`, `meeting-booking` (opener scripts).
- Proof for claims inside voiced messages comes from `product-knowledge`.
- Per-account context (prospect name, role, trigger details) comes from
  `account-memory`.
- Outbound compliance constraints (opt-out, cadence limits) are governed
  by `rules/common/outbound-compliance.md` and are not overridden by voice
  preferences.
- This skill is command-less (auto-trigger / sub-workflow). Drafting skills
  invoke it; it is not a standalone slash command.
