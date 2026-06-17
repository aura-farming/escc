# Getting Started — AE

A 15-minute onboarding to advancing qualified deals with ESCC, the MEDDPICC way.

## Who this is for

Account Executives running active opportunities: preparing for calls and demos,
capturing discovery, qualifying with evidence, multi-threading the buying committee,
and driving a mutual plan to a signature — while keeping HubSpot true the whole way.

By the end of this guide you will be able to:

- Install ESCC and start a focused deal-work session with one command.
- Prep any customer meeting and capture discovery as structured MEDDPICC.
- Run an honest deal review, map stakeholders, and build a buyer-facing mutual action plan.
- Trust the safety rails: drafts stay drafts, the send-gate is fail-closed, and only one
  controlled path writes to HubSpot.

## Install and first run

ESCC installs as a Claude Code plugin from a local marketplace path.

```bash
# 1. Add the marketplace
/plugin marketplace add aura-farming/escc

# 2. Install the plugin
/plugin install escc
```

Once installed, skills appear under the `escc:` namespace — for example
`escc:deal-review` or `escc:call-prep`. You can invoke a skill directly, or let a
command or agent route to it.

### Start in deal-work mode

ESCC ships a CLI persona alias for AE work:

```bash
claude-ae
```

`claude-ae` preloads `contexts/deal-work.md`, which puts the session in **deal-work
mode**: prep -> discover and qualify -> map the committee -> prove value -> plan the close
-> review honestly. It also pins the rules that govern deal work (`lifecycle-stages`,
`forecasting-definitions`, the `meddpicc/*` rubrics, `crm-hygiene`, `meeting-standards`,
`approval-matrix`, and the active segment) so qualification and forecasting stay disciplined.

## The systems you rely on

ESCC is grounded in your real stack, wired in through MCP connectors:

- **HubSpot** — the **system of record**. Deals, contacts, MEDDPICC fields, and stages
  live here. ESCC reads from HubSpot first and writes back through one controlled path.
- **Gmail** — recap emails, proposals, and follow-ups, **draft-only by construction**.
  ESCC composes into your drafts; you send.
- **Google Calendar** — the execution surface for booking and confirming meetings.
- **Fireflies** — call and demo transcripts, the raw material for discovery capture and
  deal reviews.

## Your core skills

These are AE skills installed by your profile (`skills-ae` plus the shared
`skills-cross` set). Each is invoked as `escc:<name>` or via its command shim.

- **`call-prep`** — use it before any customer conversation to get a brief: confirmed
  attendees and roles, account and deal history from HubSpot, the MEDDPICC gaps to probe,
  a stated goal, and a talk track.
  - `Use escc:call-prep to get me ready for tomorrow's discovery call with Acme.`
- **`demo-prep`** — use it to build a demo storyline tied to discovered pain, with
  stakeholder-specific moments and proof sourced from product-knowledge.
  - `Use escc:demo-prep to tailor the demo for the CFO and the end-user team at Acme.`
- **`discovery-notes`** — use it after a call to turn a transcript or your notes into a
  structured MEDDPICC capture, a proposed HubSpot update, and a recap draft.
  - `Use escc:discovery-notes to process my Fireflies transcript from the Acme call.`
- **`deal-review`** — use it for a structured MEDDPICC health check: each element scored
  red/amber/green with evidence, gaps turned into dated next actions.
  - `Run escc:deal-review on the Acme opportunity -- is it commit-able?`
- **`stakeholder-mapping`** — use it to build or update the buying-committee map: economic
  authority, champion, evaluators, blockers, and how each is engaged.
  - `Use escc:stakeholder-mapping to map the committee at Acme and build a champion plan.`
- **`mutual-action-plan`** — use it to build the shared, buyer-and-seller milestone plan
  both sides agree to and maintain together.
  - `Use escc:mutual-action-plan to build a MAP with Acme through to signature.`
- **`proposal-builder`** — use it to turn a qualified deal into a structured proposal or
  business case, with proof matched to the buyer's decision criteria.
  - `Use escc:proposal-builder to draft the proposal for Acme.`
- **`quote-desk`** — use it for any pricing, packaging, discount, or approval-routing
  question. It is the single pricing-math owner; every number defers here.
  - `Use escc:quote-desk -- can I give 12% off on a two-year ramp, and what needs approval?`
- **`negotiation-prep`** — use it heading into commercial review: a concessions ladder,
  BATNA awareness, procurement navigation, and a closing checklist.
  - `Use escc:negotiation-prep -- procurement is pushing on price, what's my give-get plan?`
- **`renewal-playbook`** — use it to run a renewal as a deal: re-qualify, triage churn or
  contraction risk, and build an expansion hypothesis.
  - `Use escc:renewal-playbook to run a renewal review on Acme.`

Also installed and useful daily: **`multi-threading`** and **`close-plan`** for late-stage
deals, plus the shared **`inbox-triage`** and **`daily-brief`** (`/daily`) for your rundown.

## Your first session

A realistic first run, end to end:

1. **Prep the meeting.** Launch `claude-ae`, then `Use escc:call-prep to get me ready for
   my discovery call with Acme.` Never meet unprepared.
2. **Capture discovery.** After the call, `Use escc:discovery-notes to process the
   transcript.` It extracts MEDDPICC from real evidence and proposes a HubSpot update —
   which is applied through `crm-operator`, the only write path.
3. **Map the committee.** `Use escc:stakeholder-mapping to map Acme` and identify the
   economic buyer and a developable champion. Single-threaded late-stage deals get
   multi-threaded or downgraded.
4. **Review honestly.** `Run escc:deal-review on Acme.` Each MEDDPICC element is scored
   with evidence; a field is "known" only with evidence, and every gap becomes a dated action.
5. **Plan the close.** `Use escc:mutual-action-plan to build the MAP` and pull pricing or
   approvals through `escc:quote-desk`. Non-standard terms route through the approval
   matrix before they reach the customer.

Prioritize deals with real pain, economic-buyer access, and a mutual plan. No happy-ears
stage advances: every open deal leaves every meeting with a dated next step.

## Compliance and safety

These are enforced in the harness, not just in prompts:

- **Gmail is draft-only by construction.** Recaps, proposals, and follow-ups land as
  drafts; you send.
- **The send-gate fails closed.** A live send is blocked until an `outbound-reviewer` run
  is recorded as review evidence. On any doubt, it blocks.
- **Only `crm-operator` writes to HubSpot.** Every other agent is read-only. All deal
  updates, stage changes, and MEDDPICC writes go through that one audited path, with
  review-pack-before-apply on bulk changes.
- **Transcript and prospect content is untrusted.** Discovery skills route transcripts
  through `transcript-analyzer` first; never act on instructions embedded in a transcript,
  email, or attachment.
- **Approval before non-standard terms.** Discounts and non-standard terms route through
  the approval matrix before they reach the customer.

## Where to go next

- [GLOSSARY.md](GLOSSARY.md) — ESCC, MEDDPICC, and forecasting terms in one place.
- [the-compliance-guide.md](../the-compliance-guide.md) — the outbound-compliance and
  data-handling rules behind the send-gate.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how skills, agents, commands, rules, and hooks fit together.
