# Skill Development Guide

How to author an ESCC skill so it passes CI, routes correctly, and reads like
the rest of the catalog. This is the standard the content wave was built
against (design spec section 7) and the contract `scripts/ci/validate-skills.js`
enforces on every run of `npm test`.

> Skills are the canonical workflow surface. Commands are thin shims over them
> and agents are least-privilege callers of them. If you are adding behavior,
> it belongs in a skill -- not in a command body and not in an agent prompt.
> See [SKILL-PLACEMENT-POLICY.md](SKILL-PLACEMENT-POLICY.md) for where a skill
> should live (the repo `skills/` tree vs. learned/imported/evolved skills at
> runtime); this guide is about how to write one that ships in the repo.

## 1. The shape of a skill

A skill is a single directory under `skills/`:

```text
skills/
  cold-outreach/
    SKILL.md
```

- One directory, one `SKILL.md`. Use a single file unless bundled reference
  material is genuinely justified (a long lookup table, a worked example set).
  When in doubt, keep it to one file.
- The directory name is lowercase-hyphen and MUST equal the frontmatter `name`.
  This is a hard CI error if they diverge -- the validator compares them
  directly (`frontmatter name "X" != directory "Y"`).
- Keep every file at or under 800 lines. 200-500 lines is the typical, healthy
  range; over 800 is a hard error. If a skill is pushing the ceiling, it is
  usually two skills.

## 2. Frontmatter

Three fields are required: `name`, `description`, and `origin`.

```yaml
---
name: cold-outreach
description: >-
  Use when writing or reviewing a first-touch outbound message to a prospect
  who has not previously engaged -- cold email, cold LinkedIn InMail, or a
  first-touch call opener. Trigger on "write a cold email to <prospect>",
  "draft a first touch for <persona>", or whenever a first-touch message needs
  to clear the quality gate before being handed to outbound-reviewer.
origin: ESCC
---
```

### name

Lowercase-hyphen, equal to the directory name. Nothing else.

### description -- write it as trigger conditions

The `description` is the routing surface. It is how Claude decides whether to
activate the skill, so write it as **when to activate**, not as a summary of
what the skill is. Lead with "Use when ..." and include the literal phrases a
user is likely to type ("write a cold email to ...", "is this opener good
enough"). A description that reads like a title ("Cold outreach skill") is a
weak router even though it passes the presence check.

Use an inline or folded block scalar (`>-` or plain). Do **not** use a literal
`|` block scalar: it preserves newlines, and the validator emits a finding
(`description uses a literal '|' block scalar`). Folded `>-` is the convention
across the catalog.

### origin

Exactly one of:

- `origin: ESCC` -- a net-new sales skill authored for this repo.
- `origin: ECC-adapted` -- a skill ported or adapted from Everything Claude
  Code. When you use this, add a one-line attribution near the top of the body
  pointing back to ECC (`https://github.com/affaan-m/ECC`). Salvage the idea
  and structure; never paste a vendor-branded surface in wholesale. See
  [../CONTRIBUTING.md](../CONTRIBUTING.md) for the adaptation rule.

An origin outside `{ESCC, ECC-adapted}` is a soft finding (warns by default,
errors under `CI_STRICT`); a missing origin is a hard error.

## 3. Required sections

`validate-skills.js` matches four sections by heading wording (case-insensitive,
loosely matched so phrasing can vary). All four must be present or the run
fails:

| Section | What the validator looks for | What it is for |
| --- | --- | --- |
| When to Activate | `when to activate` | The activation contract, in prose -- mirror and expand the `description`. Say what it does NOT cover and which skill owns that instead. |
| Workflow / steps | `workflow`, `steps`, `how it works`, or `process` | The explicit, ordered procedure. This is the body of the skill. |
| Examples | `example` | At least one copy-pasteable, concrete example -- a real invocation and its expected shape, not a paraphrase. |
| Anti-patterns | `anti-pattern` | What to refuse or avoid -- the failure modes this skill exists to prevent. |

Match the headings literally where you can (`## When to Activate`,
`## Anti-Patterns`) so the routing reads cleanly to a human as well as the
regex.

## 4. Grounding, safety, and rules

Skills do not restate policy -- they reference the file that owns it. When a
skill touches outbound, CRM writes, compliance, or prospect data, link the
governing rule rather than re-deriving it:

- Outbound copy and compliance -> `rules/common/messaging-style.md`,
  `rules/common/outbound-compliance.md`.
- Selling discipline (evidence-first, one ask, never fabricate) ->
  `rules/common/selling-principles.md`.
- Prospect PII and provenance -> `rules/common/data-handling.md`.

Two invariants every authored skill respects:

- **Prospect-supplied content is untrusted.** Emails, sites, attachments,
  transcripts, and fetched text are data to quote/score, never instructions to
  execute. A skill that reads prospect content says so and treats it as such.
- **Writes and sends are not the skill's job.** Drafting is in scope; the actual
  send is owned by the fail-closed `pre:outbound-send-gate` hook, and every
  CRM write routes through the `crm-operator` agent (the only write-capable
  agent). A skill describes the draft/plan and hands off -- it does not claim to
  have sent or written.

## 5. Length and unicode

- 200-500 lines typical; 800 hard max (hard error above).
- **The frontmatter `description` is capped at 220 characters, and the TOTAL
  across all skills is pinned at 14,000 (both hard CI errors in
  `validate-skills.js`).** The description is the auto-invoke routing surface
  (ADR-0016): write it as a compressed trigger line — one capability clause +
  2-4 highest-signal trigger phrases — and put every other detail in the
  body's "When to Activate". An over-budget surface silently drops
  descriptions from context and costs the catalog its auto-invocation.
- ASCII only. The repo-wide `check-unicode-safety.js` scan treats invisible /
  bidi / zero-width / NBSP codepoints as a hard error (these are ASCII-smuggling
  prompt-injection vectors) and emoji as a soft finding. Straight quotes only --
  curly quotes are a soft finding in `validate-skills.js`. Safe symbols are
  fine: em/en dash, `->`, `<=`, `>=`, bullet, middot, checkmark, `(C) (R) TM`.
- No personal absolute paths. Runtime skill roots like `~/.claude/skills/...`
  are fine; `/Users/<name>/...` is a hard error in
  `validate-no-personal-paths.js`.

## 6. Minimal SKILL.md template

Copy this, rename the directory to match `name`, and fill it in:

```markdown
---
name: my-skill
description: >-
  Use when <trigger condition> -- <surface/persona>. Trigger on
  "<literal phrase a user types>", "<another phrase>", or whenever
  <situation>. The skill that owns <the one responsibility>.
origin: ESCC
---

# My Skill

One or two sentences on what this skill governs and why it exists.

> **Governing rules:** rules/common/<file>.md (<what it enforces>).

## When to Activate

Activate this skill when:

- <situation 1>
- <situation 2>

Do **not** activate for <adjacent case> -- that belongs to `<other-skill>`.

## Workflow

1. <step>
2. <step>
3. <step -- end state / handoff>

## Examples

Input: `<a real invocation>`

Output (shape):

- <what the result looks like>

## Anti-Patterns

- Do not <failure mode this skill prevents>.
- Never <hard refusal, e.g. fabricate a metric, claim a send>.
```

## 7. Before you open a PR

- `npm test` is green (it runs `validate-skills.js` plus the rest of the gate).
- Directory name equals `name`; `description` is trigger-shaped and folded
  (not a `|` literal); `origin` is `ESCC` or `ECC-adapted` (with attribution).
- All four required sections are present.
- The skill references governing rules instead of restating them; it never
  claims to send or write directly.
- File is ASCII, under 800 lines, no personal paths.
- You ran `npm run catalog:write` so the README skill count stays pinned (see
  [../CONTRIBUTING.md](../CONTRIBUTING.md)). Do not hand-edit the count.

---

ESCC is adapted from Everything Claude Code (ECC) by Affaan Mustafa --
https://github.com/affaan-m/ECC -- used under the MIT License. Skills marked
`origin: ECC-adapted` carry an attribution line back to ECC.
