---
name: team-init
description: >-
  Set up a new ESCC workspace — detect the connected GTM stack, write a
  tailored workspace CLAUDE.md. Trigger: 'init my workspace', 'set up ESCC for
  my team', /team-init. Installs = configure-escc.
origin: ESCC
---

# Team Init

Sets up a **workspace-local CLAUDE.md** that captures the detected GTM stack,
sender identity, ICP pointer, and persona. It is the first step any rep or team
should run in a new project directory — before prospecting, before outreach,
before anything else.

> **Safety posture:** This skill does NOTHING to the CRM, sends nothing, and reads
> only locally available MCP tool-name metadata (not prospect data). Writing
> CLAUDE.md is a local-file action only. `crm-operator` remains the sole CRM writer.

## When to Activate

- User says `/team-init`, "init my workspace", "set up my GTM stack", "configure my ESCC workspace".
- A new project directory lacks a CLAUDE.md and the user is beginning sales work.
- A team lead is onboarding reps and wants a standard baseline config written.
- The connected GTM stack has changed (new CRM, new email tool) and the workspace config is stale.

Do **not** activate for:
- General "how does X work" questions -- route to `escc-guide`.
- Installing ESCC components or changing install profiles -- route to `configure-escc`.
- Any action that reads or writes HubSpot -- that is `crm-operator` territory.

## Workflow

### Step 1 -- Detect the connected GTM stack

Inspect the **names of currently available MCP tools** (what tools are wired up
in this session). This is a metadata-only read -- no prospect data is touched.

For each entry in `config/gtm-stack-mappings.json`, test whether any available
tool name matches the indicator glob:

| Indicator pattern | Stack |
|---|---|
| `mcp__hubspot__*` | HubSpot CRM (system of record) |
| `mcp__*[Gg]mail*` | Gmail (draft-only by construction) |
| `mcp__*Google_Calendar*` | Google Calendar |
| `mcp__*[Ff]ireflies*` | Fireflies (call transcripts) |
| `mcp__*[Ss]lack*` | Slack (alert delivery) |
| `mcp__*[Ee]xa*` | Exa (web research) |
| `mcp__*firecrawl*` | Firecrawl (web crawl/extract) |
| `mcp__*[Aa]pollo*` | Apollo (prospecting data) |
| `mcp__*[Cc]lay*` | Clay (enrichment) |
| `mcp__*[Zz]apier*` | Zapier (multi-app automation) |

Collect every matched entry. Each match contributes its `recommends` block:
`skills`, `rules`, `hooks`, and optionally a `profile` hint.

If NO tools are detected, record the workspace as "offline / unconnected" and
note in the output that the user should wire up MCP tools and re-run.

### Step 2 -- Collect sender identity and persona

Ask the user (or infer from git config / existing context) for the two items that
personalize every skill downstream:

1. **Sender identity** (name, title, company, email address) -- this is the
   VOICE PROFILE header that outreach skills use. Example:
   `Alex Kim, SDR, Acme -- alex@acme.example`

2. **Persona** -- select one:
   - `sdr` -- prospecting, cold outreach, inbound triage, meeting booking
   - `ae` -- call prep, discovery, deal review, proposals, negotiation
   - `sales-manager` -- pipeline hygiene, forecast rollup, coaching
   - `revops` -- GTM stack ops, CRM hygiene, routing rules, reporting
   - `full` -- full ESCC surface (team leads, power users, solo founders)

If the user has already answered these in a prior session and `.claude/escc/identity.json`
exists, read it and propose "keep existing / update" rather than re-asking.

### Step 3 -- Resolve recommended surface from mappings

Merge the `recommends` blocks from all matched mappings into three lists:

- **Skills to activate** (deduplicated, sorted): the union of all matched
  `skills` arrays from `config/gtm-stack-mappings.json`.
- **Rules to load** (deduplicated): the union of all matched `rules` arrays.
- **Hooks to enable** (deduplicated): the union of all matched `hooks` arrays.
- **Suggested base profile**: if any mapping recommends a `profile`, surface the
  highest-privilege one (precedence: `full` > `revops` > `ae` > `sdr`), but let
  the user override with their chosen persona from Step 2.

### Step 4 -- Dry-run summary

Before writing any file, output a clear plan showing:

```
Detected GTM stack:
  - HubSpot CRM (system of record) [mcp__hubspot__*]
  - Gmail draft-only [mcp__claude_ai_Gmail__*]
  - Fireflies transcripts [mcp__claude_ai_Fireflies__*]

Sender identity: Alex Kim, SDR, Acme <alex@acme.example>
Persona: sdr

Recommended skills: cold-outreach, email-outbound-ops, follow-up-ops,
  inbox-triage, outbound-sequences, reply-handling, account-research,
  account-memory, meeting-booking, discovery-notes, call-review
Recommended rules: outbound-compliance, messaging-style, data-handling,
  meeting-standards
Recommended hooks: pre:outbound-send-gate, post:outbound-style-check,
  post:crm-log-reminder

CLAUDE.md will be written to: ./CLAUDE.md
  (append-safe: existing file will be shown as diff before applying)

Proceed? [yes / edit / cancel]
```

Wait for confirmation. Do not write anything until the user says yes or approves.

### Step 5 -- Write the workspace CLAUDE.md

On approval, write (or append-merge into) `./CLAUDE.md` with this structure:

```markdown
# Workspace: ESCC Sales Config
<!-- Generated by team-init -- re-run /team-init to refresh -->

## GTM Stack
<!-- detected from available MCP tool names -->
- HubSpot CRM (system of record): mcp__hubspot__*
- Gmail (draft-only): mcp__claude_ai_Gmail__*
- Fireflies (transcripts): mcp__claude_ai_Fireflies__*

## Sender Identity
Name: Alex Kim
Title: SDR
Company: Acme
Email: alex@acme.example

## Persona
sdr

## ICP Pointer
<!-- Edit this line to reference your ICP profile skill or context file -->
See: skills/icp-profile/SKILL.md

## Recommended Skills (auto-loaded)
cold-outreach, email-outbound-ops, follow-up-ops, inbox-triage,
outbound-sequences, reply-handling, account-research, account-memory,
meeting-booking, discovery-notes, call-review, meeting-followthrough

## Recommended Rules
outbound-compliance, messaging-style, data-handling, meeting-standards

## Recommended Hooks
pre:outbound-send-gate, post:outbound-style-check, post:crm-log-reminder

## ESCC Notes
- Gmail is draft-only by construction. No agent sends email.
- pre:outbound-send-gate fails CLOSED. Clean outbound-reviewer output
  is required before any live send.
- crm-operator is the only HubSpot writer.
```

If a CLAUDE.md already exists:
- Read it.
- Show the proposed diff (added ESCC section only).
- Do not overwrite any existing non-ESCC content.
- Append the ESCC section after existing content.

### Step 6 -- Confirm and exit

After writing, output:

```
Workspace initialized.
  File written: ./CLAUDE.md
  Persona: sdr
  Stack: HubSpot + Gmail + Fireflies (3 tools)

Next steps:
  1. Run /prospect or escc:prospecting-pipeline to build your first account list.
  2. Run /sequence or escc:outbound-sequences to start an outbound play.
  3. Run /team-init again after connecting new MCP tools.
  4. To install additional ESCC components: escc:configure-escc
```

## Examples

**Clean first run:**

```text
/team-init
-> Detects: HubSpot + Gmail + Google Calendar
-> Asks: sender identity and persona (ae selected)
-> Dry-run summary shown, user approves
-> Writes CLAUDE.md with ae surface + HubSpot + email + calendar skills
```

**Re-run after adding Fireflies:**

```text
/team-init
-> Detects: HubSpot + Gmail + Google Calendar + Fireflies (new)
-> Existing CLAUDE.md found -- shows diff
-> Adds: discovery-notes, call-review, meeting-followthrough
-> Appends diff only, existing CLAUDE.md content preserved
```

**Offline / no MCP tools connected:**

```text
/team-init
-> No tool matches found
-> Output: "No GTM tools detected. Connect HubSpot, Gmail, or other
   MCP tools and re-run /team-init to get a tailored workspace config."
-> CLAUDE.md not written (nothing useful to write)
```

## Anti-patterns

- **Reading prospect data during detection.** Stack detection reads TOOL NAMES only
  (metadata). Never call any MCP tool to detect the stack -- just inspect what tools
  are available by name.
- **Writing CRM records.** team-init writes ONE local file (CLAUDE.md). Any CRM
  mutation belongs to `crm-operator`, not here.
- **Overwriting existing CLAUDE.md without diff review.** Always show the proposed
  change and wait for approval before modifying an existing file.
- **Conflating team-init with configure-escc.** team-init writes a workspace config.
  configure-escc installs ESCC components (skills, rules, hooks). They are separate.
- **Skipping the dry-run step.** No file is written until the user approves the plan.

## Related

- `config/gtm-stack-mappings.json` -- the indicator-to-recommendations map this skill reads.
- `schemas/gtm-stack-mappings.schema.json` -- the schema that validates the map.
- `configure-escc` -- installs ESCC components (skills/rules/hooks); complementary to team-init.
- `escc-guide` -- answers navigation and "how do I" questions.
- `icp-profile` -- the ICP definition the workspace config points to.
- Command: `/team-init` (thin shim delegating here).
