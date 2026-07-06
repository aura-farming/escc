---
name: configure-escc
description: >-
  Install/update ESCC components via a persona wizard. Trigger: 'configure
  escc', 'install escc', 'I want the SDR module', 'change my persona'.
  Auto-triggers; command-less.
origin: ESCC
---

# Configure ESCC

An **AskUserQuestion-driven install wizard** for EverythingSales Claude Code. It
guides the user through selecting a persona and resolving the matching module set,
shows a dry-run plan, and applies the install via `scripts/install.js`. No files
are written until the user approves.

> **Scope of this skill:** install ESCC components (skills, rules, hooks, agents,
> commands) into the user or project .claude/ directory. It does NOT set up the
> workspace CLAUDE.md (that is `team-init`) and does NOT write to the CRM (that
> is `crm-operator`).

## When to Activate

- User says "configure escc", "install escc", "set up escc", "install the SDR module".
- User wants to change their install profile or add/remove persona modules.
- First-time install after `/plugin install escc`.
- User wants to verify or repair an existing ESCC install.
- User says "what install profiles are available" or "which modules come with AE".

Do **not** activate for:
- Workspace setup (writing CLAUDE.md) -- route to `team-init`.
- Navigation or "how do I" questions -- route to `escc-guide`.
- Any CRM action -- route to `crm-operator`.

## Prerequisites

ESCC must be reachable before this skill runs. Two paths:

1. **Via plugin** (standard): `/plugin install escc` loads this skill automatically.
2. **Bootstrap** (manual): copy only `skills/configure-escc/SKILL.md` to
   `~/.claude/skills/configure-escc/SKILL.md`, then say "configure escc".
   The wizard will handle the rest.

## Workflow

### Step 0 -- Locate the ESCC source root

Before any install step, determine the source root. Try in order:

1. `ESCC_ROOT` environment variable, if set.
2. The directory containing this SKILL.md file (resolved via `__dirname` analog).
3. If neither is available, ask the user:
   "Please provide the path to your local ESCC repo checkout, or run
   `/plugin install escc` from the Claude Code marketplace."

All subsequent file operations read from `$ESCC_ROOT` and write to
`$TARGET` (the install destination resolved in Step 1).

### Step 0.5 -- Stack health check (MCP connections)

ESCC's skills run on the user's real stack; an install that "succeeds" with no
MCP wired fails silently at first use. Before installing, check which MCP tool
families are visible in this session and report:

```
Stack health:
  HubSpot   (mcp__hubspot__*)                REQUIRED   [connected / MISSING]
  Gmail     (mcp__claude_ai_Gmail__*)        REQUIRED   [connected / MISSING]
  Calendar  (mcp__claude_ai_Google_Calendar__*)  recommended  [connected / missing]
  Fireflies (mcp__claude_ai_Fireflies__*)    optional   [connected / missing]
  Enrichment (Apollo / Clay)                 optional   [connected / missing]
```

- If **HubSpot or Gmail is MISSING**, say so plainly and point at the fix
  (`/mcp` to connect via claude.ai connectors, or `mcp-configs/` templates for
  self-hosted servers). Ask whether to continue anyway — never proceed
  silently, and never claim the install is "ready to sell from" when a
  required connection is absent.
- Missing optional tools are noted, not blocking (`team-init` tailors the
  workspace to whatever is actually wired).

### Step 1 -- Choose install level

Use `AskUserQuestion`:

```
Question: "Where should ESCC components be installed?"
Options:
  - "User-level (~/.claude/)" -- "Applies to all your projects; recommended for reps"
  - "Project-level (.claude/)" -- "Applies only to this project directory"
  - "Both" -- "Shared components user-level, project overrides project-level"
```

Set `INSTALL_LEVEL` and derive `TARGET`:
- User-level: `TARGET = ~/.claude`
- Project-level: `TARGET = .claude` (relative to project root)
- Both: `TARGET_USER = ~/.claude`, `TARGET_PROJECT = .claude`

### Step 2 -- Select a persona (install profile)

Use `AskUserQuestion`:

```
Question: "Which persona profile do you want to install?"
Options:
  - "sdr" -- "Prospecting, cold outreach, sequences, follow-up, inbound triage, meeting booking"
  - "ae" -- "Call prep, discovery, deal review, proposals, negotiation, battlecards, RFP"
  - "sales-manager" -- "Pipeline hygiene, forecast rollup, deal inspection, coaching"
  - "revops" -- "CRM hygiene, routing, reporting, GTM stack ops, territory planning"
  - "full" -- "All ESCC personas combined (team leads, power users, solo founders)"
```

Store the choice as `SELECTED_PROFILE`. Each profile resolves a module set from
the install manifests (defined in `manifests/*.json` -- authored in Phase 6; the
wizard refers to them by name and runs `scripts/install.js --profile <profile>`
to resolve the actual file list at runtime).

**Module composition reference (what each profile includes):**

| Profile | Skills bundle | Agents | Rules |
|---|---|---|---|
| sdr | cold-outreach, outbound-sequences, prospecting-pipeline, follow-up-ops, inbox-triage, reply-handling, meeting-booking, icp-profile, trigger-detection, account-research, account-memory, email-outbound-ops, daily-brief, opt-out-handling | outreach-drafter, outbound-reviewer, prospect-researcher, signal-scorer, warm-path-mapper | outbound-compliance, messaging-style, data-handling |
| ae | call-prep, call-review, discovery-notes, deal-review, stakeholder-mapping, mutual-action-plan, proposal-builder, competitor-battlecards, negotiation-prep, rfp-response, business-case, demo-prep, close-plan, evaluation-plan | transcript-analyzer, deal-reviewer, proposal-writer, competitor-analyst | meeting-standards, data-handling |
| sales-manager | pipeline-hygiene, forecast-rollup, coaching-prep, deal-inspection, capacity-planning, sales-reporting, qbr-builder, win-loss-analysis | pipeline-auditor, forecast-analyst, coaching-analyst | forecasting-definitions |
| revops | crm-hygiene, dedupe-merge, lead-routing, sales-handoffs, territory-planning, sales-reporting, rep-onboarding, instincts | crm-operator, metrics-analyst, pipeline-auditor | crm-hygiene, lifecycle-stages, routing-rules |
| full | All of the above | All 18 agents | All rule sets |

### Step 3 -- Resolve the install plan (dry-run)

Run the installer in dry-run mode to get the concrete file list:

```bash
node "$ESCC_ROOT/scripts/install.js" plan \
  --profile "$SELECTED_PROFILE" \
  --target "$INSTALL_LEVEL" \
  --source "$ESCC_ROOT"
```

If `scripts/install.js` is not yet available (early install or bootstrap mode),
fall back to listing the module contents from the table in Step 2 and note that
the plan is a reference list, not a validated file-by-file diff.

Display the plan output clearly:

```
Install plan (dry-run):
  Profile:   ae
  Target:    ~/.claude  (user-level)
  Source:    $ESCC_ROOT

  Skills to install (14):
    call-prep, call-review, discovery-notes, deal-review, stakeholder-mapping,
    mutual-action-plan, proposal-builder, competitor-battlecards,
    negotiation-prep, rfp-response, business-case, demo-prep, close-plan,
    evaluation-plan

  Agents to install (5):
    transcript-analyzer, deal-reviewer, proposal-writer, competitor-analyst

  Rules to install:
    common/meeting-standards, common/data-handling

  Hooks enabled by profile:
    post:crm-log-reminder (reminder after meetings/calls)

  Files that would be created/updated: [list from installer output]
  Existing files that would be merged/appended: [list any collisions]

  Scripts/install.js plan hash: [hash if available]

Proceed with install? [yes / edit profile / cancel]
```

Wait for the user's answer.

### Step 4 -- Apply the install

On "yes", run the apply command:

```bash
node "$ESCC_ROOT/scripts/install.js" apply \
  --profile "$SELECTED_PROFILE" \
  --target "$INSTALL_LEVEL" \
  --source "$ESCC_ROOT"
```

Stream the output so the user can see progress. If the script errors, surface the
error message verbatim and suggest the fix (missing source file, permissions, etc.)
before retrying.

**Collision handling:**
- If a target file already exists and the content differs, show a unified diff
  and ask: "Overwrite / Skip / Merge (append ESCC section)".
- Never silently overwrite user customizations.

### Step 5 -- Post-install verification

After apply completes, run a quick verification pass:

1. Check that the expected skill directories exist at `$TARGET/skills/<name>/SKILL.md`.
2. Check that rule files exist at `$TARGET/rules/<name>.md` (or the ESCC layered path).
3. Check that agent files exist at `$TARGET/agents/<name>.md`.
4. Check that cross-references within installed skills resolve (a skill that mentions
   another skill by name -- verify the referenced skill was also installed).
5. Run the machine check: `node "$ESCC_ROOT/scripts/escc.js" doctor --exit-code`
   -- it verifies every managed target against install-state and reports drift.
   A non-zero exit means a gap: show the doctor output and offer
   `node "$ESCC_ROOT/scripts/escc.js" repair`.

Report any gaps:

```
Verification:
  14/14 skills installed correctly.
  4/4 agents installed correctly.
  2/2 rule sets installed correctly.

  Warnings:
    - skills/stakeholder-mapping/SKILL.md references account-memory -- also installed. OK.
    - No gaps detected.
```

### Step 6 -- Optional optimization pass

Use `AskUserQuestion`:

```
Question: "Would you like to optimize the installed files for your context?"
Options:
  - "Yes -- tailor skills to my GTM stack" -- "Removes irrelevant sections based on your connected tools"
  - "Yes -- tailor rules to my preferences" -- "Adjusts coverage targets and naming conventions"
  - "Yes -- both" -- "Full optimization pass"
  - "Skip" -- "Keep everything as installed"
```

If the user chooses to optimize:
- Read each installed SKILL.md.
- Ask about their GTM stack (if not already known from a team-init run).
- Propose specific section removals or additions.
- Edit files in `$TARGET` only -- NEVER modify `$ESCC_ROOT` source files.

### Step 6.5 -- Seed knowledge, voice, and persona focus

The install lands generic by design (company-neutral, ADR-0013). Offer the
three first-run seedings that make it *theirs* — each optional, none silent:

Use `AskUserQuestion` (multi-select):

```
Question: "Seed your workspace now? (all optional — you can do any of these later)"
Options:
  - "Vocabulary" -- "escc product vocab init: your segments/competitors, gitignored, survives updates"
  - "Voice + knowledge" -- "/ingest your sent emails, case studies, pricing docs into the right layers"
  - "Persona routing focus" -- "Write skillOverrides so auto-invoke spends its budget on YOUR persona's skills"
```

- **Vocabulary:** run `node "$ESCC_ROOT/scripts/escc.js" product vocab init`,
  then walk the user through editing segments/competitors (or route an
  industries list through `escc product vocab suggest`).
- **Voice + knowledge:** hand off to the `knowledge-intake` skill (`/ingest`)
  with whatever the user has — sent emails (voice), case studies/pricing
  (knowledge candidates), an ICP list (vocab suggestions).
- **Persona routing focus (optional, reversible):** for a single-persona
  install, offer to write `skillOverrides` into `$TARGET/settings.json`
  setting NON-persona skills to `"name-only"` — on small-context models this
  spends the skill-description budget on the persona's own skills. Show the
  exact JSON before writing, note it is fully reversible (delete the block),
  and default to Skip.

### Step 7 -- Installation summary

Print the completion report:

```
## ESCC Install Complete

Profile:    ae
Target:     user-level (~/.claude)
Source:     $ESCC_ROOT

Skills installed (14):  call-prep, call-review, discovery-notes, deal-review,
  stakeholder-mapping, mutual-action-plan, proposal-builder, competitor-battlecards,
  negotiation-prep, rfp-response, business-case, demo-prep, close-plan, evaluation-plan

Agents installed (4):   transcript-analyzer, deal-reviewer, proposal-writer, competitor-analyst

Rules installed:        common/meeting-standards, common/data-handling

Hooks active:           post:crm-log-reminder

Verification:           14/14 skills, 4/4 agents, 2/2 rules -- no gaps.
Optimizations:          none (skipped)

Next steps:
  1. Run /team-init to write your workspace CLAUDE.md from the connected stack.
  2. Optional: shell persona alias so sessions open pre-focused (adjust the path):
       alias claude-ae='claude --append-system-prompt-file "$ESCC_ROOT/contexts/deal-work.md"'
     (SDR: contexts/prospecting.md · Manager: contexts/pipeline-review.md)
  3. Start with /daily for your brief, /call-prep before your next call, or
     /deal-review for a deal.
  4. To add more personas later, say "configure escc" again.
```

## Examples

**First-time install, AE profile:**

```text
User: "configure escc"
configure-escc:
  Step 0: finds ESCC_ROOT from plugin path.
  Step 1: asks install level -> user-level selected.
  Step 2: asks persona -> ae selected.
  Step 3: dry-run shows 14 skills, 4 agents, 2 rule sets.
  User: "yes"
  Step 4: applies install.
  Step 5: verification passes.
  Step 6: optimization skipped.
  Step 7: summary printed.
```

**Add sales-manager on top of existing AE install:**

```text
User: "I'm now also covering my team -- add the manager modules"
configure-escc:
  Step 2: profile = sales-manager.
  Step 3: dry-run shows 5 skills + 3 agents; flags 2 existing files (merge prompt).
  User: "merge"
  Step 4: applies, existing files appended not overwritten.
  Step 5: verification passes.
  Summary: "sales-manager modules added to existing ae install."
```

**Bootstrap before plugin install:**

```text
User: "set up escc" (no plugin installed yet)
configure-escc:
  Step 0: ESCC_ROOT not available via plugin.
  -> Ask: "Provide a path to your ESCC repo, or run /plugin install escc first."
  User: provides local path.
  -> Wizard continues from Step 1.
```

## Anti-patterns

- **Writing to ESCC_ROOT source files.** All file writes go to `$TARGET`
  (`~/.claude` or `.claude`). NEVER modify files in the source repo.
- **Conflating configure-escc with team-init.** configure-escc installs components
  (skills/rules/hooks). team-init writes the workspace CLAUDE.md. They are
  complementary, not interchangeable.
- **Installing without a dry-run.** Always show the plan and wait for approval
  before applying. No silent installs.
- **Touching the CRM.** This skill writes local files only. crm-operator is the
  sole CRM writer.
- **Silently overwriting user customizations.** Always show a diff and get
  confirmation before overwriting any existing file that has been modified.
- **Guessing module contents.** If `scripts/install.js` is available, use it.
  If not, clearly label the fallback list as a reference, not a file-by-file guarantee.

## Related

- `scripts/install.js` -- the plan+apply entrypoint; this skill drives it.
- `manifests/*.json` -- install profile definitions (Phase 6 deliverable; referenced
  by name here; scripts/install.js resolves them at runtime).
- `team-init` -- workspace CLAUDE.md setup; complementary first step.
- `escc-guide` -- navigation and "how do I" questions.
- No command shim -- auto-triggers on "configure escc" and related phrases.
