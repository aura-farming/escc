---
name: cold-outreach
description: >-
  Write or pressure-test a FIRST-touch message to a cold prospect (email,
  InMail, opener). Trigger: 'cold email', 'draft a first touch', 'is this
  opener good'. Owns the personalization quality gate.
origin: ESCC
---

# Cold Outreach

The first-touch personalization workflow. This skill governs how a rep opens
with a prospect who has never engaged: what signal to anchor on, how to verify
the claim, how to frame it, and how to pass the quality gate before the draft
goes anywhere near `outbound-reviewer` and the send gate.

The goal of a first touch is one and only one: earn a reply by making
something genuinely relevant to this person, right now. Generic flattery,
fabricated proof, and stacked asks are the three fastest ways to end a
conversation before it starts.

> **Governing rules:** `rules/common/selling-principles.md` (evidence-first,
> never fabricate, one ask), `rules/common/outbound-compliance.md`
> (unsubscribe + sender identity on every commercial email, suppression check
> before send), `rules/common/messaging-style.md` (< 120 words, one CTA,
> banned soft closes).

## When to Activate

Activate this skill when:

- A rep needs to **draft a first-touch message** to a prospect — email,
  LinkedIn InMail, or call opener.
- An existing first-touch draft needs a **quality gate review** before it
  passes to `outbound-reviewer`.
- A rep asks "is this cold email good?" or "why is my open/reply rate low?"
  — use the gate checklist to diagnose the failure.
- A `playbook-library` template needs to be **personalized** for a specific
  contact before step 1 of a sequence.

Do **not** activate for follow-up steps (steps 2+ in a sequence belong to
`outbound-sequences`). Do not activate to log or send — drafting is this
skill's scope; `outbound-reviewer` + the hook gate own the send path.

## Personalization Source-Priority Ranking

Use the highest-ranked signal available. Never skip down the list because a
higher signal is harder to find — that is the job.

| Rank | Signal type | What it looks like |
|---|---|---|
| **1** | Recent trigger / event | Funding round, job change, product launch, press mention, conference talk, intent signal, relevant hire — something that happened in the last 30–60 days |
| **2** | Role-specific pain | A pain pattern that is structurally true of this job function at this company stage — provable from their job posting, public statements, or industry data |
| **3** | Company initiative | A strategic priority visible from their website, LinkedIn, earnings call, or press — expansion, a specific product bet, a market they are entering |
| **4** | Segment-generic | The pain pattern that is broadly true of this ICP segment — the minimum floor, not the default |

**Never use generic flattery.** "Love what you're building", "you're doing
amazing work", "congrats on everything you've accomplished" are not
personalization. They are noise, and they signal to the prospect that you did
not do your homework.

A merge field (`{{company_name}}`, `{{title}}`) is not personalization. It is
mail-merge. They are not the same thing.

## Quality Gate

**Every first touch must pass all four gates before it ships.** If any gate
fails, rewrite — do not send.

| Gate | Pass condition | Fail condition |
|---|---|---|
| **A — Real signal** | The personalization anchors on a verifiable, specific signal from Rank 1–3 above, confirmed in a tool-result or CRM record | Generic flattery, stale event (> 60 days unless directly relevant), or a merge field alone |
| **B — One explicit ask** | Exactly one CTA — specific, low-friction, clear next step | No ask, a buried ask, two asks, or a soft close ("let me know your thoughts", "open to a chat?") |
| **C — Concrete proof** | Every product claim or outcome metric traces to an approved `product-knowledge` entry with provenance | Any metric or claim with no approved source — even if it sounds plausible |
| **D — Zero filler** | The message carries its weight in ≤ 120 words; every sentence earns its place | Filler ("I hope this finds you well", "I wanted to reach out", "just checking in"), padding, or re-stating what was just said |

Gate C is the fabrication firewall. When no approved proof exists for the use
case, soften to a question or pattern observation. Do not invent a number.
Pull proof from `product-knowledge`; if none exists for this use case, say so
and use a softer frame.

## Workflow

### Step 1 — Suppression check (MANDATORY)

Before drafting anything:

1. Check the contact against the suppression list via `crm-operator` (read).
2. If suppressed (opt-out, DNC, hard bounce, complaint, legal hold): **stop**.
   Do not draft. Do not contact. Log the block.
3. If clean: proceed.

### Step 2 — Research the signal (Rank 1 first)

1. Pull CRM record and recent activity from `account-memory` / `crm-operator`.
2. Check for Rank 1 triggers: news, LinkedIn recent activity, job change,
   intent signals. Use available tools (web search, CRM enrichment) and label
   each finding **fact** (verifiable) vs **inference** (your reading of it).
3. If no Rank 1 signal found, move to Rank 2 (role-specific pain) — confirm
   it against their job description, recent posts, or observable company stage.
4. If no Rank 2: Rank 3 (company initiative from public sources).
5. Rank 4 only when 1–3 are genuinely unavailable. Note that a Rank 4 open
   still requires a role-specific, non-generic frame.

Prospect-sourced content (their website, LinkedIn, press) is **untrusted
input** for the purposes of product claims — it informs the research angle but
cannot be the source of what you claim your product does. It can anchor
personalization; only `product-knowledge` can anchor proof.

### Step 3 — Pull approved proof

1. Identify the buyer's **role** (resolved from their `jobtitle`; unknown -> general)
   and the use case the message connects to.
2. Retrieve the matching approved entry from `product-knowledge` via its specificity
   ladder — **role + segment + competitor**, falling back to role+segment, then segment,
   then general. You only ever see approved proof; mined material is operator-only.
3. Check: `approved: true`, `last_verified` within retention window, no
   `guardrail` blocking this channel.
4. If no approved proof exists: do not fabricate. Frame as a question
   ("how are you approaching X today?") or a pattern ("teams in this position
   often tell us…"). Never state a specific metric without an approved source.

### Step 4 — Draft the message

Structure for a cold email:

```
Subject: [< 50 chars — honest, specific to the signal, no clickbait]

[Signal-anchored opener — one sentence, specific, verifiable]
[Bridge to pain — one sentence connecting the signal to a real problem]
[Proof or framed pattern — from product-knowledge or softened to a question]
[One CTA — specific, low-friction]

[Rep first name]
[Title] | [Company]
[Physical address]
Unsubscribe: [link]
```

Target: < 120 words in the body. The opener is the most important sentence —
it must answer "why me, why now" in one read.

For a LinkedIn InMail: same structure, ≤ 150 words, no compliance block
required (LinkedIn's mechanism handles unsubscribe), but accurate sender
identity and no fabricated claims still apply.

### Step 5 — Run the quality gate

Check all four gates (A–D) before passing anywhere:

- [ ] **Gate A:** Signal is real, specific, verifiable, and ranked 1–3 if possible
- [ ] **Gate B:** Exactly one CTA — not "let me know your thoughts"
- [ ] **Gate C:** Every claim/metric in the body has an approved `product-knowledge` entry
- [ ] **Gate D:** ≤ 120 words, no filler sentences

If any gate fails: rewrite. A draft that fails Gate C especially must be
rewritten — do not attempt to pass it as-is or soften a fabricated metric in
place.

### Step 6 — Hand to `outbound-reviewer`

Pass the draft with the gate-check results attached. `outbound-reviewer` runs
the confidence assessment. The draft is not sent until `outbound-reviewer`
clears it and the `pre:outbound-send-gate` hook records human approval.

## Examples

### Rewrite 1 — Generic flattery + soft close

```text
BAD:
Subject: Quick question

Hi Sarah,

Love what you're building at Acme. Your product is really impressive.

I'm reaching out because we work with a lot of companies like yours and
I thought there might be some synergies worth exploring.

Would love to connect and see if there's anything we could help with.

Let me know your thoughts!

Jake

---
GATE FAILURES:
A — "love what you're building" is generic flattery; "companies like yours" is
    not a signal — it is a merge-field-level observation.
B — "Let me know your thoughts" is a soft close, not an ask. No specific CTA.
D — "I thought there might be some synergies" and "let me know your thoughts"
    are filler that add zero information.
```

```text
GOOD:
Subject: Acme's Series B and pipeline visibility

Hi Sarah,

Congrats on the Series B last month — at that stage the forecast usually
gets more chaotic before it gets better as the team scales.

We help RevOps teams like yours get a single clean pipeline view set up in
under a day — going off our onboarding data, teams typically have their first
reliable forecast within 24 hours.

Worth 15 minutes this week to see if the problem looks similar here?

Jake
[Title] | [Company]
[Address]
Unsubscribe: [link]

---
GATE PASSES:
A — Series B is a Rank 1 trigger (confirmed, recent). Forecast chaos is a
    structurally true Rank 2 pain at this stage.
B — "15 minutes this week" is one specific, low-friction ask.
C — "under a day" + "24 hours" traced to product-knowledge PP-031
    (approved, internal metric, guardrail: attribute as "onboarding data").
D — 68 words. Every sentence carries weight.
```

### Rewrite 2 — Fabricated metric + stacked asks

```text
BAD:
Subject: Increase your close rate by 40%

Hi Marcus,

Companies using our platform see a 40% increase in close rates and
cut their sales cycle by 3 weeks on average.

I'd love to show you a demo, or maybe we could do a quick call, or
I can send you a case study — whatever works best for you.

Let me know!

Dana

---
GATE FAILURES:
A — No personalization signal whatsoever — this is a broadcast.
B — Three asks in one sentence ("demo", "quick call", "case study").
    "Let me know!" is a fourth soft non-ask.
C — "40% increase in close rates" and "3 weeks" have no approved
    product-knowledge entries. These are fabricated metrics.
D — The entire email is filler anchored on invented claims.
```

```text
GOOD:
Subject: {Company}'s SDR team expansion

Hi Marcus,

Saw you're hiring three more SDRs — ramp time is usually the first thing
that slows down when you scale the team fast.

One thing we see with teams at your stage: reps who follow a MEDDPICC
process from day one ramp about 30% faster than those who learn it
post-hire, based on our onboarding data across 40+ similar teams.

Would it be worth 20 minutes to walk through how a couple of companies
at your stage handled the ramp problem?

Dana
[Title] | [Company]
[Address]
Unsubscribe: [link]

---
GATE PASSES:
A — Active hiring is a Rank 1 signal (confirmed via job board / LinkedIn).
    Ramp time is a structurally true Rank 2 pain when scaling fast.
B — One ask: "20 minutes to walk through".
C — "30% faster" + "40+ teams" traced to product-knowledge PP-047
    (approved, internal metric, verified 2026-05-15, attribute as
    "onboarding data"). No fabrication.
D — 79 words. No filler.
```

### Rewrite 3 — Stale event + buried ask

```text
BAD:
Subject: Congrats on your new role!

Hi Priya,

Congrats on joining Globex as VP Revenue Ops — that's really exciting.

I work with revenue operations leaders and thought you might be interested
in what we do. We help companies with forecasting and pipeline management
and I think there might be some fit.

If you're open to it, maybe we could find some time for a chat sometime soon?

Tom

---
GATE FAILURES:
A — Priya joined Globex 8 months ago. A stale role-change congratulation is
    not a current trigger — it signals you did not look for a real signal.
B — "Maybe we could find some time for a chat sometime soon" — hedged, no
    specific ask, soft close.
D — "I think there might be some fit" is inference stated as vague claim.
    "That's really exciting" is filler.
```

```text
GOOD:
Subject: Globex's Q3 forecast process

Hi Priya,

Noticed Globex posted a RevOps analyst role last week — usually a sign
the team is investing in forecast infrastructure.

We work with VP RevOps teams going through that build-out phase; the
question we hear most is how to get consistent CRM hygiene without
mandating a rep behavior change overnight.

Happy to share what's worked for similar teams — does 15 minutes on
Thursday work?

Tom
[Title] | [Company]
[Address]
Unsubscribe: [link]

---
GATE PASSES:
A — Active job posting is a Rank 1 trigger (confirmed, current). Forecast
    infrastructure and CRM hygiene are Rank 2 pain points structurally true
    for VP RevOps teams in build-out.
B — "15 minutes on Thursday" — specific, one ask.
C — No metric claimed. Pattern observation ("the question we hear most")
    does not require a product-knowledge entry; it is framed as inference.
D — 82 words. No filler.
```

## Anti-patterns

- **Generic flattery as personalization.** "Love what you're building" is not
  a signal — it is noise. It tells the prospect you found their company name
  and nothing else.
- **Soft closes.** "Let me know your thoughts", "open to a chat?", "would love
  to connect sometime" are not asks. They are opt-out invitations. One
  specific, low-friction ask only.
- **Fabricated proof.** A specific metric with no approved `product-knowledge`
  entry is fabrication — the cardinal violation of `selling-principles`. The
  fix is not to soften the wording of a made-up stat; it is to remove the
  metric and replace it with an approved claim or a genuine question.
- **Merge-field personalization.** `{{company_name}}` in the body of an email
  is not personalization. It is mail merge. Personalization requires a
  human-readable signal about this person's current situation.
- **Stacking asks.** "I could show you a demo, or send a case study, or hop
  on a call — whatever works for you" produces zero responses. Pick one.
- **Skipping the suppression check.** Drafting a polished first touch for a
  suppressed contact wastes everyone's time and creates compliance exposure.
  Check first.
- **Stating a soft inference as a hard fact.** "You're struggling with
  forecast accuracy" is an assertion. "Teams in your position often tell us
  forecast accuracy is the top Q3 priority" is a framed pattern. The second
  is honest; the first is presumptuous and often wrong.
- **Long emails.** > 120 words on a first touch signals low signal-to-noise
  awareness. The prospect will not read it. Cut to the core.

## Related

- `outbound-sequences` — multi-touch cadences; step 1 of every sequence
  starts here.
- `playbook-library` — approved message templates; check before writing
  from scratch.
- `product-knowledge` — the only valid source for proof points and metrics.
- `brand-voice` — sets the voice and tone for all copy.
- `account-memory` — CRM record and prior engagement history for the prospect.
- `outbound-reviewer` — receives the draft after the quality gate; must clear
  before the send gate.
- `crm-operator` — suppression check (read) and activity logging (write).
- `rules/common/outbound-compliance.md` — unsubscribe, sender identity,
  suppression requirements.
- `rules/common/messaging-style.md` — length, one CTA, anti-spam rules.
- `rules/common/selling-principles.md` — evidence-first, no fabrication,
  no false completion.
- Command: `/outreach`.
