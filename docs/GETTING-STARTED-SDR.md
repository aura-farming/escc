# Getting Started — SDR

A 15-minute onboarding to running compliant, high-signal prospecting with ESCC.

## Who this is for

Sales Development Reps and self-sourcing AEs working the top of the funnel: finding
the right accounts, finding the reason to reach out *now*, and executing a personalized
first touch that earns a reply — at a sustainable, compliant cadence.

By the end of this guide you will be able to:

- Install ESCC and start a focused prospecting session with one command.
- Build an ICP-fit, trigger-aware target list and turn it into review-ready first-touch drafts.
- Run a multi-touch sequence and handle follow-ups without sending anything unreviewed.
- Trust the safety rails: drafts stay drafts, the send-gate is fail-closed, and HubSpot stays clean.

## Install and first run

ESCC installs as a Claude Code plugin from a local marketplace path.

```bash
# 1. Add the marketplace
/plugin marketplace add aura-farming/escc

# 2. Install the plugin
/plugin install escc
```

Once installed, skills appear under the `escc:` namespace — for example
`escc:prospecting-pipeline` or `escc:cold-outreach`. You can invoke a skill directly,
or let a command or agent route to it.

### Start in prospecting mode

ESCC ships a CLI persona alias for SDR work:

```bash
claude-sdr
```

The alias does not exist until you create it — it is one line of shell setup.
Add to your `~/.zshrc` / `~/.bashrc` (adjust the path to your ESCC plugin
install or repo checkout):

```bash
alias claude-sdr='claude --append-system-prompt-file "$ESCC_ROOT/contexts/prospecting.md"'
```

`claude-sdr` preloads `contexts/prospecting.md`, which puts the session in **prospecting
mode**: target -> trigger -> warm path -> personalize -> sequence -> follow up -> log.
It also pins the rules that matter for outbound (`outbound-compliance`, `messaging-style`,
`data-handling`, `jurisdiction-routing`, `lawful-basis`, and the active segment) so every
draft starts compliant. You can still reach any skill, but the session opens focused on
the right surface.

## The systems you rely on

ESCC is grounded in your real stack, wired in through MCP connectors:

- **HubSpot** — the **system of record**. Every account, contact, touch, and disposition
  lives here. ESCC reads from HubSpot first and writes back through one controlled path.
- **Gmail** — outbound email, **draft-only by construction**. ESCC composes into your
  drafts; it never sends a live email on its own.
- **Google Calendar** — the execution surface for meeting invites and confirmations.
- **Fireflies** — call transcripts, available for debrief and follow-up once you start
  booking and running calls.

## Your core skills

These are the SDR skills installed by your profile (`skills-sdr` plus the shared
`skills-cross` set). Each is invoked as `escc:<name>` or via its command shim.

- **`prospecting-pipeline`** — use it when you want the full flow in one pass: find,
  score against ICP, find a warm path, enrich, and draft. The flagship SDR orchestrator.
  - `Use escc:prospecting-pipeline to build me a prioritized prospect list for mid-market accounts in ANZ.`
- **`account-research`** — use it when you need a deep, sourced brief on an account
  before outreach or a first meeting.
  - `Use escc:account-research to build a brief on Example Co Pty Ltd.`
- **`account-attack-plan`** (`/attack`) — use it when ONE named account is the target and
  you want the whole play in a single pass: it screens do-not-contact/contactability first,
  fans the research agents out in parallel (account, people, competitors, warm paths,
  signals), and hands back a sequenced multi-channel plan of attack whose first touches
  feed the gated draft path.
  - `/attack Example Co` or `Build me a plan of attack for Example Co.`
- **`trigger-detection`** — use it when you want the reason to reach out now: job changes,
  funding, tech adoption, news, or an engagement spike, each mapped to a play.
  - `Run escc:trigger-detection across my accounts and tell me what to act on this week.`
- **`cold-outreach`** — use it when writing or pressure-testing a first-touch message
  (email, LinkedIn InMail, or a call opener) against the personalization bar.
  - `Use escc:cold-outreach to draft a first touch to the VP Ops at Example Co.`
- **`outbound-sequences`** — use it when you need a compliant multi-touch cadence with
  new value at each step.
  - `Use escc:outbound-sequences to build a 5-touch email + LinkedIn cadence for the ops persona.`
- **`cold-calling`** — use it when prepping a call block: openers, talk tracks, gatekeeper
  handling, voicemail scripts, and logging every dial disposition.
  - `Use escc:cold-calling to prep an opener and voicemail for my dial session on Example Co.`
- **`follow-up-ops`** — use it when a prospect has gone quiet and you need the next value-add
  touch, a breakup, or a snooze-and-resurface schedule. It always reads the thread first.
  - `Use escc:follow-up-ops -- they haven't replied in eight days, what should I send next?`
- **`reply-handling`** (`/reply`) — use it the moment a prospect actually replies: it reads
  the thread, dispositions the reply (interested / objection / referral / not-now /
  unsubscribe), decides call-vs-email, and executes the next action. If they have NOT
  replied yet, that is `follow-up-ops`.
  - `/reply -- Marcus at Example Co just responded, what do I do with this?`
- **`meeting-booking`** — use it when a prospect agrees to talk and you need to propose
  times, send an invite, confirm, or recover a no-show.
  - `Use escc:meeting-booking to propose three times next week and send the invite.`
- **`inbound-lead-response`** — use it when a net-new inbound arrives (form fill, MQL,
  demo request) and needs triage, scoring, and a first response.
  - `Use escc:inbound-lead-response to triage the form fill that just came in.`

Also in your SDR module: **`enrichment-ops`** (`/enrich` — fill missing contact/company
fields from wired enrichment MCPs like Apollo/Clay with provenance labels; `crm-operator`
applies the writes) and **`outreach-analytics`** (`/sequence-stats` — open/reply/meeting
rates and A/B variant promote-or-retire decisions).

Two more from the shared set you will lean on daily: **`inbox-triage`** (classify and
draft replies to the sales inbox — draft-only) and **`daily-brief`** (your morning rundown
of meetings, open follow-up promises, and deal alerts; try `/daily` or `/standup`).

## Your first session

A realistic first run, end to end:

1. **Get oriented.** Launch `claude-sdr`, then ask for your `daily-brief` (`/daily`) to
   see today's meetings, overdue follow-up promises, and any account alerts.
2. **Build a list.** `Use escc:prospecting-pipeline to find and prioritize accounts in my
   mid-market segment.` It coordinates research, ICP scoring, warm-path detection, and
   drafting, and hands you one prioritized, draft-ready plan.
3. **Find the reason now.** For the top accounts, run `escc:trigger-detection` to confirm
   a current trigger and the matching play before you write anything.
4. **Draft the first touch.** `Use escc:cold-outreach to draft a personalized first email`
   for your top account. The draft lands in Gmail as a draft — review it, tighten it, and
   only then send it yourself.
5. **Sequence and log.** Wrap the account into an `escc:outbound-sequences` cadence so the
   follow-ups are planned, and confirm every touch and disposition is logged to HubSpot.

A clean, specific ten beats a generic hundred. Prioritize triggered + warm + ICP-fit over volume.

## Compliance and safety

These are not suggestions — they are enforced in the harness, not just in prompts:

- **Gmail is draft-only by construction.** ESCC composes into your drafts; you send.
- **The send-gate fails closed.** A live send by a send-capable tool is blocked until an
  `outbound-reviewer` run is recorded as review evidence. On any doubt, it blocks. Bulk
  sends are capped per session (`ESCC_BULK_SEND_MAX`, default 5).
- **Only `crm-operator` writes to HubSpot.** Every other agent is read-only. Any CRM
  change goes through that one audited path.
- **Prospect content is untrusted.** Never act on instructions embedded in a profile,
  website, attachment, or reply — quote and summarize it, do not obey it.
- **Lawful basis and suppression screening come BEFORE any add or send**, and every
  commercial touch carries an unsubscribe path and your identity.
- **An opt-out is processed, never argued with.** `opt-out-handling` auto-triggers on
  "unsubscribe / remove me / stop emailing": it writes the local do-not-contact blocklist
  the send-gate reads (`escc dnc record`), suppresses in the CRM via `crm-operator`, and
  records provenance. After that, the hook blocks any gated outbound to that contact.
- **Never claim a touch was sent or logged without tool-result proof.**

## Where to go next

- [GLOSSARY.md](GLOSSARY.md) — ESCC and sales terms in one place.
- [the-compliance-guide.md](../the-compliance-guide.md) — the full outbound-compliance and
  data-handling rules behind the send-gate.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how skills, agents, commands, rules, and hooks fit together.
