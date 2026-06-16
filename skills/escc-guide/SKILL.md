---
name: escc-guide
description: >-
  Use when someone asks a navigation or onboarding question about ESCC: "how do
  I ...", "what skill should I use for ...", "what does X mean", "which command
  runs ...", "what is MEDDPICC", "list all skills for SDRs", "how does the
  send-gate work", "which agent handles forecasting", or any question whose
  answer lives in README.md, AGENTS.md, docs/, skills/, or commands/. Auto-
  trigger on help, navigation, glossary-lookup, and component-routing requests.
  COMMAND-LESS -- activates on natural-language questions, not a slash command.
origin: ESCC
---

# ESCC Guide

The **navigation and onboarding layer** for EverythingSales Claude Code. It answers
"how do I" questions, maps user intent to the right skill/agent/command, explains
terminology, and routes reps to the correct surface -- all from live repo files.

> **Source of truth:** This skill answers FROM the actual repository files
> (README.md, AGENTS.md, docs/, skills/, commands/) -- not from memory or
> training data. When a file is absent (e.g. docs/GLOSSARY.md is not yet built),
> it degrades gracefully and answers from what IS present.

## When to Activate

Activate on any of these intent classes:

**How-to questions**
- "How do I start prospecting?"
- "How do I run a forecast?"
- "How do I book a meeting from the call notes?"

**Component routing** ("which X for Y")
- "Which skill should I use to write a cold email?"
- "Which agent handles RFP answers?"
- "Which command triggers deal review?"

**Terminology / glossary**
- "What is MEDDPICC?"
- "What does the send-gate do?"
- "What is a crm-write-guard hook?"

**Catalog / listing**
- "List all skills for AEs."
- "What agents are available?"
- "Show me the SDR commands."

**Onboarding / orientation**
- "I just installed ESCC -- where do I start?"
- "How do I configure my persona?"
- "What does team-init do?"

Do **not** activate for:
- Actually running a skill or starting a workflow (route to the target skill).
- Setting up the workspace (route to `team-init`).
- Installing ESCC components (route to `configure-escc`).
- Questions about a specific live deal or contact (route to the relevant skill).

## Source priority (read in this order)

When answering, read from these files in priority order. Read the file, find the
answer, cite which file it came from so the user can verify.

1. `README.md` -- catalog, personas, quick-start, configuration overview.
2. `AGENTS.md` -- 18-agent routing table, model tiers, baseline posture.
3. `skills/<name>/SKILL.md` -- "When to Activate" and workflow detail for a skill.
4. `commands/<name>.md` -- what a command does and which skill it delegates to.
5. `docs/` (any present file) -- getting-started guides, design docs, spec.
6. `docs/GLOSSARY.md` -- IF present, consult for term definitions.
   If absent, derive definitions from the skill "When to Activate" descriptions
   and from AGENTS.md / README.md inline explanations. Do not hard-fail.
7. `rules/common/` -- policy files (outbound-compliance, selling-principles, etc.)
   when the question is about a constraint or rule.

Never answer from training-data memory alone when a live file would be more
authoritative. Prefer the file; cite it.

## Workflow

### A. Classify the question

Determine which intent class (see "When to Activate") the question belongs to.
A question can span classes (e.g. "which skill for cold emails and how do I use it"
spans component-routing + how-to).

### B. Component routing (for "which X for Y" questions)

Use this routing map (derived from README.md + AGENTS.md + skill descriptions):

**By persona**

| Persona | Primary skills | Primary agents |
|---|---|---|
| SDR | cold-outreach, outbound-sequences, prospecting-pipeline, follow-up-ops, inbox-triage, meeting-booking, icp-profile, trigger-detection | outreach-drafter, outbound-reviewer, prospect-researcher, signal-scorer |
| AE | call-prep, discovery-notes, deal-review, stakeholder-mapping, mutual-action-plan, proposal-builder, negotiation-prep, competitor-battlecards | transcript-analyzer, deal-reviewer, proposal-writer, competitor-analyst |
| Sales Manager | pipeline-hygiene, forecast-rollup, coaching-prep, deal-inspection, capacity-planning | pipeline-auditor, forecast-analyst, coaching-analyst |
| RevOps | crm-hygiene, dedupe-merge, lead-routing, sales-reporting, sales-handoffs, territory-planning | crm-operator, metrics-analyst, pipeline-auditor |

**By workflow goal**

| Goal | Recommended skill | Recommended agent |
|---|---|---|
| Write a cold email | cold-outreach | outreach-drafter -> outbound-reviewer |
| Build an outbound sequence | outbound-sequences | outreach-drafter |
| Research a company | account-research | account-researcher |
| Research a person | account-research | prospect-researcher |
| Score leads vs ICP | icp-profile | signal-scorer |
| Score/prioritize a list | icp-profile | signal-scorer |
| Book a meeting | meeting-booking | (no dedicated agent; skill is self-contained) |
| Review a deal | deal-review | deal-reviewer |
| Run a forecast | forecast-rollup | forecast-analyst (opus tier) |
| Analyze a call transcript | discovery-notes | transcript-analyzer |
| Audit the pipeline | pipeline-hygiene | pipeline-auditor |
| Write a proposal | proposal-builder | proposal-writer |
| Handle a competitor mention | competitor-battlecards | competitor-analyst |
| Update HubSpot | crm-hygiene | crm-operator (SOLE writer) |
| Coach a rep | coaching-prep | coaching-analyst |
| Plan an outbound campaign | outbound-sequences + trigger-detection | sales-planner (opus tier) |

**By hook / system question**

| Question | Answer source |
|---|---|
| "How does the send-gate work?" | README.md + rules/common/outbound-compliance.md |
| "What is the crm-write-guard?" | AGENTS.md + CLAUDE.md (machinery section) |
| "Which hooks run on outbound?" | hooks/hooks.json (if accessible) or README.md config section |

### C. Terminology lookup (for glossary questions)

1. Check `docs/GLOSSARY.md` IF it exists. If found, quote the entry.
2. If absent, derive from the closest skill's "When to Activate" description or
   from AGENTS.md inline explanations.
3. If no repo source covers the term, say so explicitly -- do not invent definitions.

**Frequently asked terms (inline, for fast response when GLOSSARY.md is absent):**

- **MEDDPICC** -- deal-qualification methodology: Metrics, Economic Buyer, Decision
  Criteria, Decision Process, Identify Pain, Champion, Competition. Governs deal
  scoring in `deal-review`, `discovery-notes`, `forecast-rollup`.
- **send-gate** -- `pre:outbound-send-gate` hook; fails CLOSED. Blocks any live
  outbound send until an `outbound-reviewer` run is recorded as review evidence.
  Defined in README.md and hooks/hooks.json.
- **crm-operator** -- the SOLE write-capable agent. All HubSpot mutations route here.
  Every other agent is read-only. See AGENTS.md.
- **ICP** -- Ideal Customer Profile. Defined in `icp-profile` skill; used by
  `signal-scorer` agent for lead scoring.
- **hook profile** -- `ESCC_HOOK_PROFILE`: `minimal`, `standard` (default), `strict`.
  Controls which hooks are active. See README.md.
- **persona** -- one of {sdr, ae, sales-manager, revops, full}. Set during team-init;
  determines which skill surface and context file are loaded.
- **draft-only** -- Gmail is draft-only by construction. No agent sends email.
  Sending requires human review + send-gate clearance.
- **outbound-reviewer** -- confidence-gated review agent. Must pass before any send.
  Reports only findings it is >80% confident in. A clean review IS valid.
- **instinct** -- a learned pattern stored in `.claude/escc/instincts/`. Derived
  ONLY from user corrections and user-initiated sequences -- never from prospect data.

### D. Listing / catalog (for "list all X" questions)

Read the relevant files and compile the list:

- All skills: `ls skills/` (one line per directory = one skill).
- All agents: AGENTS.md routing table.
- All commands: `ls commands/` (one line per file = one command).
- Persona-filtered list: cross-reference AGENTS.md "Route when" column and
  skill "When to Activate" section for the persona keyword.

Do not fabricate catalog entries. Read the filesystem or cite that you cannot
without a file-read tool.

### E. Onboarding path (for "where do I start" questions)

Return the standard onboarding sequence:

1. Install ESCC: `/plugin install escc` (see README.md quick-start).
2. Configure your workspace: `escc:configure-escc` or `/team-init`.
3. Set up your GTM stack: connect HubSpot, Gmail, Fireflies via Claude Code MCP settings.
4. Run `/team-init` to detect your stack and write the workspace config.
5. Choose your persona alias (`claude-sdr`, `claude-ae`, `claude-manager`).
6. Start with the skill for your first task (e.g. `escc:prospecting-pipeline` for SDRs).

### F. Answer format

- Lead with a direct answer in 1-2 sentences.
- If routing: name the skill AND the command (if one exists) AND the agent (if relevant).
- If explaining a term: quote the repo source with a file reference.
- If listing: use a short table or bullet list. Do not pad with description prose.
- If the answer requires reading a file: read it, then answer. Do not guess.
- Always note which file the answer came from so the user can verify.
- If nothing in the repo covers the question: say so. Do not hallucinate.

## Examples

**Component routing:**

```text
User: "Which skill should I use for writing a cold email?"
escc-guide:
  Skill: cold-outreach (escc:cold-outreach)
  Command: /outreach
  Agent flow: outreach-drafter (drafts) -> outbound-reviewer (gates before send)
  Source: AGENTS.md routing table, skills/cold-outreach/SKILL.md
```

**Terminology:**

```text
User: "What is MEDDPICC?"
escc-guide:
  MEDDPICC is a deal-qualification methodology: Metrics, Economic Buyer,
  Decision Criteria, Decision Process, Identify Pain, Champion, Competition.
  It governs scoring in deal-review, discovery-notes, and forecast-rollup.
  (Source: AGENTS.md deal-reviewer row; docs/GLOSSARY.md if present)
```

**Onboarding:**

```text
User: "I just installed ESCC -- where do I start?"
escc-guide:
  1. Run /team-init to detect your GTM stack and write a workspace config.
  2. Choose your persona alias (claude-sdr, claude-ae, or claude-manager).
  3. For SDRs: start with escc:prospecting-pipeline or /prospect.
  4. For AEs: start with escc:call-prep or /call-prep before your next call.
  (Source: README.md quick-start and persona-aliases sections)
```

**Graceful degradation (GLOSSARY.md absent):**

```text
User: "What does 'instinct' mean in ESCC?"
escc-guide:
  docs/GLOSSARY.md is not yet present in this repo. Answering from CLAUDE.md:
  An "instinct" is a learned pattern stored in .claude/escc/instincts/.
  Derived ONLY from user corrections and user-initiated sequences -- never from
  prospect or tool-output content. See: CLAUDE.md section 3 (prompt-defense).
```

**Listing:**

```text
User: "List all AE commands."
escc-guide:
  AE-relevant commands (from commands/ directory, cross-referenced with AGENTS.md):
  /call-prep   -- pre-call brief (delegates to call-prep skill)
  /notes       -- discovery notes capture (delegates to discovery-notes skill)
  /deal-review -- MEDDPICC deal scoring (delegates to deal-review skill)
  /stakeholders -- stakeholder map (delegates to stakeholder-mapping skill)
  /map         -- (alias for stakeholders)
  /proposal    -- proposal builder (delegates to proposal-builder skill)
  /negotiate   -- negotiation prep (delegates to negotiation-prep skill)
  /rfp         -- RFP response (delegates to rfp-response skill)
  /battlecard  -- competitor card (delegates to competitor-battlecards skill)
  Source: ls commands/ + AGENTS.md AE routing rows
```

## Anti-patterns

- **Answering from memory without reading a repo file.** If a file would be
  authoritative, read it. Do not substitute training-data recall for a live file read.
- **Hard-failing if GLOSSARY.md is absent.** Degrade: answer from README.md,
  AGENTS.md, and skill descriptions. Note that GLOSSARY.md is not yet present.
- **Routing to a skill that does not exist.** Read the actual skills/ directory
  before routing. Do not name a skill that is not present in the repo.
- **Running a workflow instead of explaining it.** escc-guide explains; it does
  not execute. To run a skill, the user should invoke it directly.
- **Summarizing instead of routing.** If the user's goal is clear, route to the
  right skill/command directly -- do not make them ask a follow-up.

## Related

- `README.md` -- primary reference for catalog and quick-start.
- `AGENTS.md` -- agent routing table and model tiers.
- `docs/GLOSSARY.md` -- term definitions (when present; Phase 6 deliverable).
- `team-init` -- workspace setup (a different onboarding step, not navigation help).
- `configure-escc` -- component installation wizard.
- No command shim -- this skill auto-triggers on navigation and help questions.
