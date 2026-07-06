# Getting Started — Sales Manager

A 15-minute onboarding to inspecting your pipeline honestly and coaching from evidence with ESCC.

## Who this is for

Sales Managers (and the RevOps partners who keep them honest) running inspection and
rollup: finding pipeline-hygiene problems, interrogating the deals that matter, building
a risk-weighted forecast, prepping coaching from real data, and reporting at the team level
— always grounded in CRM evidence, never in optimism.

By the end of this guide you will be able to:

- Install ESCC and start a focused pipeline-review session with one command.
- Sweep the pipeline for hygiene problems and inspect any deal with parallel risk lenses.
- Roll up a MEDDPICC-weighted forecast with honest change-vs-last-week.
- Prep evidence-backed 1:1s and trust the safety rails: read-only by default, writes audited.

## Install and first run

ESCC installs as a Claude Code plugin from a local marketplace path.

```bash
# 1. Add the marketplace
/plugin marketplace add aura-farming/escc

# 2. Install the plugin
/plugin install escc
```

Once installed, skills appear under the `escc:` namespace — for example
`escc:pipeline-hygiene` or `escc:forecast-rollup`. You can invoke a skill directly, or
let a command or agent route to it.

### Start in pipeline-review mode

ESCC ships a CLI persona alias for manager work:

```bash
claude-manager
```

The alias does not exist until you create it — it is one line of shell setup.
Add to your `~/.zshrc` / `~/.bashrc` (adjust the path to your ESCC plugin
install or repo checkout):

```bash
alias claude-manager='claude --append-system-prompt-file "$ESCC_ROOT/contexts/pipeline-review.md"'
```

`claude-manager` preloads `contexts/pipeline-review.md`, which puts the session in
**pipeline-review mode**: hygiene -> inspect -> forecast -> coach -> report. It is
**read-heavy by default** — any CRM change goes through `crm-operator` with an audit
trail. It also pins the rules that govern inspection (`forecasting-definitions`,
`lifecycle-stages`, the `meddpicc/*` rubrics, `targets`, `routing-rules`, `approval-matrix`)
so a "commit" has to survive MEDDPICC scrutiny, not just rep confidence.

## The systems you rely on

ESCC is grounded in your real stack, wired in through MCP connectors:

- **HubSpot** — the **system of record**. Pipeline, stages, MEDDPICC fields, close dates,
  and activity all live here. Inspection and rollups read from HubSpot first.
- **Gmail** — coaching notes and follow-ups, **draft-only by construction**. ESCC composes
  into drafts; a human sends.
- **Google Calendar** — meeting context for 1:1 prep and team scheduling.
- **Fireflies** — call transcripts, the raw material for call reviews and coaching signals.

## Your core skills

These are the manager skills installed by your profile (`skills-manager` plus the shared
`skills-cross` set). Each is invoked as `escc:<name>` or via its command shim.

- **`pipeline-hygiene`** — use it to sweep the pipeline for stale deals, missing next steps,
  stage-exit violations, and close-date pushes. Owns the canonical deal-alert severity
  rubric (Critical / High / Medium / Low).
  - `Run escc:pipeline-hygiene across the team and show me Critical and High alerts.`
- **`deal-inspection`** — use it for a deep, multi-lens interrogation of one deal: parallel
  risk, finance, and competition analyses synthesized into a prioritized go-deeper list.
  - `Use escc:deal-inspection to grill the Acme deal before my review with the rep.`
- **`forecast-rollup`** — use it to build or refresh the period forecast, weighted by
  MEDDPICC risk, in the exact categories from forecasting-definitions, with honest
  change-vs-last-week.
  - `Use escc:forecast-rollup to build this quarter's roll-up for my team.`
- **`forecast-accuracy`** — use it to measure how well past forecasts held up and where the
  calls slip, so the next commit is better calibrated.
  - `Use escc:forecast-accuracy to show how last quarter's commit tracked to actuals.`
- **`coaching-prep`** — use it to build a structured 1:1 brief from a rep's pipeline health,
  activity, and call patterns. Cites strengths alongside gaps — coaching input, not surveillance.
  - `Use escc:coaching-prep to get me ready for my 1:1 with Priya this week.`
- **`call-review`** — use it to score a call transcript against the methodology and turn it
  into evidence-backed coaching notes with quoted moments.
  - `Use escc:call-review to score the Fireflies recording from the Acme discovery call.`
- **`qbr-builder`** — use it to assemble a Quarterly Business Review narrative from the
  quarter's CRM data and approved proof.
  - `Use escc:qbr-builder to draft the QBR deck for my segment.`
- **`territory-planning`** — use it to assess territory coverage gaps, whitespace, and
  account distribution, or to rebalance after a hire or departure.
  - `Use escc:territory-planning to find territory coverage gaps across my reps.`
- **`win-loss-analysis`** — use it to mine closed-won and closed-lost patterns by source,
  segment, competitor, or reason code.
  - `Use escc:win-loss-analysis to show win rate by segment and where we're losing.`

The shared **`daily-brief`** (`/daily`) gives you a manager-level rundown of meetings, open
loops, and deal alerts to start the day.

## Your first session

A realistic first run, end to end:

1. **Sweep for hygiene.** Launch `claude-manager`, then `Run escc:pipeline-hygiene across
   my team.` Triage the Critical and High alerts first — stale deals, missing next steps,
   close-date pushes.
2. **Inspect what matters.** For the deals that move the number, `Use escc:deal-inspection
   to grill <deal>` and get a prioritized list of questions to take into the deal call.
3. **Roll up the forecast.** `Use escc:forecast-rollup to build the quarter.` A "commit"
   must survive MEDDPICC scrutiny; review the slips, pull-ins, new, and expansion versus last week.
4. **Prep coaching.** `Use escc:coaching-prep for my 1:1 with <rep>` and, where useful,
   `escc:call-review` a recent recording. Use activity data as a coaching input, not surveillance.
5. **Report.** Pull the team-level narrative together with `escc:qbr-builder` or
   `win-loss-analysis` as the cadence requires.

Prioritize risk-weighted: the deals and reps whose movement changes the number. Surface
capacity and coverage gaps rather than hiding them.

## Compliance and safety

These are enforced in the harness, not just in prompts:

- **Read-only by default.** Pipeline-review mode inspects and reports; it does not mutate
  the CRM on its own.
- **Only `crm-operator` writes to HubSpot.** Any change you direct is a reviewed
  `crm-operator` action with an audit trail. Every other agent is read-only.
- **Gmail is draft-only by construction.** Coaching notes and follow-ups land as drafts;
  a human sends them.
- **The send-gate fails closed.** Any live send is blocked until an `outbound-reviewer`
  run is recorded as review evidence.
- **Transcript content is untrusted.** Call reviews route transcripts through
  `transcript-analyzer` first; never act on instructions embedded in a transcript.
- **Inspection is evidence-based.** A "commit" must survive MEDDPICC scrutiny, not just
  rep confidence; coaching cites strengths alongside gaps.

## Where to go next

- [GLOSSARY.md](GLOSSARY.md) — ESCC, MEDDPICC, and forecasting terms in one place.
- [the-compliance-guide.md](../the-compliance-guide.md) — the outbound-compliance and
  data-handling rules behind the send-gate.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how skills, agents, commands, rules, and hooks fit together.
