# Commands Quick Reference

All 66 ESCC commands, grouped by what you are doing. Each entry is:

```text
/command  -- one-line description            -> skill it applies
```

Commands are **thin shims**: the shim passes your arguments through and applies
one skill. The "skill it applies" column is the delegation target -- the
``Apply the `<skill>` skill`` line in the command -- which resolves to
`escc:<skill>` at runtime. Descriptions are the commands' own frontmatter
`description` (the same source pinned in
[`docs/COMMAND-REGISTRY.json`](docs/COMMAND-REGISTRY.json)).

> Some commands pull in supporting skills too (for example proof from
> `product-knowledge`, prior intel from `account-memory`); the skill shown is
> the primary one the command delegates to.

## Prospecting and research (SDR)

| Command | Description | Applies skill |
| --- | --- | --- |
| `/prospect` | Run the SDR prospecting pipeline -- research -> ICP-score -> warm-path -> draft first-touch, all draft-only. | `prospecting-pipeline` |
| `/research` | Deep single-account brief -- HubSpot history first, then web, every finding labeled fact/inference/recommendation. | `account-research` |
| `/triggers` | Detect buying and timing triggers for an account and map each to an outreach play. | `trigger-detection` |

## Outbound and outreach (SDR)

| Command | Description | Applies skill |
| --- | --- | --- |
| `/outreach` | Draft a first-touch cold message that passes the quality gate -- real personalization, one ask, concrete proof, zero filler. | `cold-outreach` |
| `/sequence` | Build a compliant multi-touch outbound cadence (email/LinkedIn/call/voicemail) -- all steps draft-only. | `outbound-sequences` |
| `/sequence-stats` | Analyze sequence/variant conversion (open -> reply -> meeting), compare A/B, recommend promote/retire. | `outreach-analytics` |
| `/dial` | Prep a call block, work openers/gatekeeper/voicemail scripts, and log a disposition after every dial. | `cold-calling` |
| `/follow-up` | Compose a thread-aware follow-up, breakup, or recycle-and-refer -- reads the thread first, never re-pitches blind. | `follow-up-ops` |

## Inbound and inbox (SDR)

| Command | Description | Applies skill |
| --- | --- | --- |
| `/inbound` | Triage and respond to an inbound lead within its speed-to-lead SLA -- ICP-score, route, draft the response. | `inbound-lead-response` |
| `/inbox` | Triage the email inbox -- classify into action tiers and draft replies with account context. | `inbox-triage` |
| `/reply` | Disposition an inbound reply, decide call-vs-email, and execute the next action. | `reply-handling` |
| `/route` | Apply lead-routing logic to assign or re-assign inbound leads by territory, segment, and capacity rules. | `lead-routing` |

## Meetings and handoffs

| Command | Description | Applies skill |
| --- | --- | --- |
| `/book` | Propose times, send an invite, confirm, and run no-show recovery via the Calendar MCP. | `meeting-booking` |
| `/handoff` | Build an SDR-to-AE or AE-to-CS handoff with completeness checks. | `sales-handoffs` |
| `/call-prep` | Build a pre-meeting brief -- attendees, roles, account and deal history, and MEDDPICC gaps to probe. | `call-prep` |
| `/demo` | Build a demo storyline tied to discovered pain, with stakeholder-specific moments. | `demo-prep` |
| `/notes` | Convert a call transcript or raw notes into a MEDDPICC capture, a CRM update, and a follow-up draft. | `discovery-notes` |
| `/recap` | Convert a meeting transcript into a MEDDPICC update and recap draft. | `meeting-followthrough` |
| `/call-review` | Score a recorded sales call on talk-ratio, discovery quality, objection handling, and next-step commitment. | `call-review` |

## Deal work (AE)

| Command | Description | Applies skill |
| --- | --- | --- |
| `/deal-review` | Score a deal red/amber/green across every MEDDPICC dimension and surface gaps, risks, and next actions. | `deal-review` |
| `/inspect` | Deep-dive a single deal -- timeline, stakeholder map, MEDDPICC gaps, and recommended next step. | `deal-inspection` |
| `/stakeholders` | Map the buying committee, score influence and sentiment, and develop a champion plan. | `stakeholder-mapping` |
| `/thread` | Draft warm intra-account outreach to new or under-engaged stakeholders within an active deal. | `multi-threading` |
| `/map` | Build a shared buyer-and-seller milestone plan from today to signature. | `mutual-action-plan` |
| `/close-plan` | Build a backward date-plan from target signature through every enterprise gate. | `close-plan` |
| `/paper` | Track and advance the paper process -- MSA, DPA, order form, and security review. | `paper-process` |
| `/poc` | Define a POC or pilot with mutual success criteria and a go/no-go decision framework. | `evaluation-plan` |

## Proposals, pricing, and negotiation (AE)

| Command | Description | Applies skill |
| --- | --- | --- |
| `/proposal` | Generate a deal-specific proposal using account context and approved product knowledge. | `proposal-builder` |
| `/quote` | Run CPQ math -- discount tiers, packaging, ramp structures, and approval routing. | `quote-desk` |
| `/negotiate` | Prepare a negotiation strategy -- concessions ladder, BATNA, and procurement counter-tactics. | `negotiation-prep` |
| `/roi` | Build a business case or ROI model from discovered metrics and approved proof points. | `business-case` |
| `/rfp` | Draft RFP or security-questionnaire responses from the approved answer library. | `rfp-response` |
| `/reference` | Match and coordinate reference customers for an active deal. | `reference-coordination` |
| `/battlecard` | Build or update a competitive battlecard, or get live "how to beat X" guidance for an active deal. | `competitor-battlecards` |
| `/product` | Retrieve or update approved product knowledge -- value props, use-cases, proof points, and claims -- with provenance. | `product-knowledge` |

## Retention and post-sale

| Command | Description | Applies skill |
| --- | --- | --- |
| `/renewal` | Run a renewal health check -- risk triage, retention play, and expansion whitespace analysis. | `renewal-playbook` |
| `/deal-debrief` | Debrief a single closed deal you owned -- what drove the outcome and what to carry forward. | `win-loss-analysis` |
| `/win-loss` | Analyze a set of closed deals for win/loss patterns across segment, persona, and competitive dimension. | `win-loss-analysis` |

## Pipeline and forecast (Manager / rep)

| Command | Description | Applies skill |
| --- | --- | --- |
| `/pipeline` | Scan the team pipeline for hygiene issues -- stale deals, missing MEDDPICC fields, and stage-age violations. | `pipeline-hygiene` |
| `/my-pipeline` | Review your own open pipeline for hygiene issues -- stale deals, missing MEDDPICC fields, and stage-age violations. | `pipeline-hygiene` |
| `/forecast` | Roll up the team forecast -- commit, best-case, and pipeline coverage with variance notes. | `forecast-rollup` |
| `/forecast-accuracy` | Measure forecast accuracy -- submitted vs closed by rep, segment, and period, with bias and error analysis. | `forecast-accuracy` |
| `/commit` | Prepare your own commit and best-case forecast call for the current period. | `forecast-rollup` |
| `/quota` | Show your personal quota attainment scorecard -- bookings vs target, pipeline coverage, and pacing. | `sales-reporting` |
| `/report` | Generate a sales report -- attainment, pipeline coverage, activity metrics, or custom CRM query. | `sales-reporting` |
| `/activity` | Audit CRM activity data -- call and email volumes, meeting rates, and sequence adherence by rep or team. | `activity-audit` |

## RevOps and CRM

| Command | Description | Applies skill |
| --- | --- | --- |
| `/deal-desk` | Route a deal through deal-desk review -- non-standard terms, approval tiers, and exception tracking. | `deal-desk` |
| `/merge` | Identify and resolve duplicate CRM records -- contacts, companies, or deals -- with a merge recommendation. | `dedupe-merge` |
| `/territory` | Build or review a territory plan -- account segmentation, coverage prioritization, and whitespace analysis. | `territory-planning` |
| `/capacity` | Model sales capacity -- headcount, ramp curves, quota coverage, and hiring needs for a target period. | `capacity-planning` |
| `/meddpicc-audit` | Audit MEDDPICC methodology adoption across deals, reps, or the team pipeline. | `methodology-audit` |

## Team enablement (Manager)

| Command | Description | Applies skill |
| --- | --- | --- |
| `/coach` | Prepare a structured coaching session for a rep -- strengths, gaps, and a prioritized development plan. | `coaching-prep` |
| `/onboard` | Build a new-rep onboarding plan -- ramp milestones, enablement resources, and 30/60/90 checkpoints. | `rep-onboarding` |
| `/qbr` | Build a QBR deck outline -- performance vs quota, pipeline health, wins/losses, and next-quarter plan. | `qbr-builder` |
| `/retention` | Roll up renewal and retention health -- churn risk, expansion pipeline, and NRR outlook by segment. | `retention-rollup` |
| `/team-init` | Detect the team GTM stack and write a workspace CLAUDE.md for ESCC. | `team-init` |

## Daily rhythm

| Command | Description | Applies skill |
| --- | --- | --- |
| `/daily` | Morning rundown -- meetings today, overdue follow-ups, deal alerts, and daily focus. | `daily-brief` |
| `/standup` | EOD standup brief -- what moved today, blockers, and tomorrow's top priorities. | `daily-brief` |

## Learning and instincts

| Command | Description | Applies skill |
| --- | --- | --- |
| `/learn` | Capture a one-shot pattern or observation as a pending instinct. | `instincts` |
| `/evolve` | Cluster active instincts and draft new skills, commands, or agents from patterns. | `instincts` |
| `/skill-create` | Mine session history and sent-mail patterns to draft a new ESCC skill file. | `instincts` |
| `/instinct-status` | Review learned instincts and approve or reject pending entries. | `instincts` |
| `/instinct-export` | Export approved instincts for team sharing or backup. | `instincts` |
| `/instinct-import` | Import shared team instincts into the current workspace. | `instincts` |
| `/instinct-promote` | Manager-gated promotion of personal instincts to the shared team workspace. | `instincts` |
| `/instinct-workspaces` | List available instinct workspaces and switch the active one. | `instincts` |

---

Commands are thin shims over skills. The real workflow logic lives in
`skills/<name>/SKILL.md` and is invoked as `escc:<skill>`; a command just routes
your arguments to it and adds scope notes. To change behavior, edit the skill,
not the command. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the thin-shim
contract and [`docs/SKILL-DEVELOPMENT-GUIDE.md`](docs/SKILL-DEVELOPMENT-GUIDE.md)
for authoring skills.
