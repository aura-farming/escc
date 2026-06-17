# Skill Placement Policy

Where a skill lives, and what that placement guarantees. ESCC distinguishes
**curated** skills (shipped in this repo) from **learned / imported / evolved**
skills (created or installed at runtime under the user's home). The two live in
different places, carry different trust, and only one of them is validated by
CI.

> For how to author a curated skill, see
> [SKILL-DEVELOPMENT-GUIDE.md](SKILL-DEVELOPMENT-GUIDE.md). This document is
> about placement and provenance, not authoring mechanics.

## 1. The two homes for a skill

### Curated -- `skills/` (in this repo, shipped)

The skills tracked in this repository under `skills/<name>/SKILL.md`. These are
the catalog: reviewed, CI-validated, version-pinned, and shipped when the plugin
is installed. They are the canonical workflow surface and the only skills
commands are allowed to delegate to (`validate-commands.js` fails a command
whose "Apply the `<skill>` skill" target is not a real directory in `skills/`).

- Authored to the standard in the development guide.
- Validated on every `npm test` run by `scripts/ci/validate-skills.js`.
- Counted and CI-pinned into the README catalog by `scripts/ci/catalog.js`.

### Learned / imported / evolved -- `~/.claude/skills/*` (at runtime)

Skills that come into existence on a user's machine, not in the repo. They live
under the runtime skills root (`~/.claude/skills/...`), are personal or
team-scoped, and are **not** part of the shipped plugin. Three ways they arise:

- **Learned** -- distilled from a user's own sessions by the instinct/continuous
  -learning machinery. A recurring pattern becomes an instinct; an approved,
  high-confidence instinct can be promoted into a skill. This is the
  `/learn` -> `/instinct-status` -> `/evolve` path (all backed by the
  `instincts` skill). Nothing is auto-promoted: promotion is human-reviewed.
- **Imported** -- brought in from a teammate or a shared export
  (`/instinct-export` / `/instinct-import`, manager-gated `/instinct-promote`).
  The content originated in another workspace.
- **Evolved** -- an existing learned skill refined over time as confidence and
  evidence accumulate.

Because these are runtime artifacts, refer to them only by the `~/.claude/`
runtime root -- never by an absolute `/Users/...` path (that is a hard CI error
in `validate-no-personal-paths.js`, and it would not be portable anyway).

## 2. What CI validates -- and what it does not

`scripts/ci/validate-skills.js` walks the repo `skills/` directory only. It has
no visibility into `~/.claude/skills/*` and makes no attempt to reach there.

| | Curated (`skills/`) | Learned / imported / evolved (`~/.claude/skills/*`) |
| --- | --- | --- |
| Validated by `validate-skills.js` | Yes | No |
| Counted in the README catalog | Yes | No |
| A command may delegate to it | Yes | No -- the delegation target must exist in repo `skills/` |
| Trust level | Reviewed and shipped | User/team-local; governed by review + provenance, not CI |

The practical consequence: **a learned skill is not a curated skill.** Promoting
a learned skill into the shipped catalog is a deliberate act -- you copy it into
`skills/<name>/SKILL.md`, bring it up to the authoring standard, attach
provenance if its content derives from anything untrusted, and let CI validate
it. It does not become curated by being useful at runtime.

## 3. Provenance -- where a skill's content came from

Learned content carries a provenance record so its source and trust are
explicit. The record is defined by
[`schemas/provenance.schema.json`](../schemas/provenance.schema.json)
("ESCC data provenance record") and governed by `rules/common/data-handling.md`.
It is attached to account-memory fields, `/learn` output, and durable intel --
including the content a learned skill is distilled from.

The only required field is `source`. The fields that matter for placement:

| Field | Meaning |
| --- | --- |
| `source` (required) | Origin label, e.g. `hubspot`, `gmail`, `user`, `web:exa`, `instinct:evolved`, `manual`. |
| `source_type` | One of `crm`, `email`, `web`, `user`, `inferred`, `document`, `call`, `manual`. |
| `confidence` | 0..1 -- how much to trust the value. |
| `untrusted` | `true` if derived from untrusted prospect content (prompt-defense invariant I3). |
| `retrieved_at` / `lawful_basis` / `note` | Capture time, GDPR lawful basis (see `rules/lawful-basis.md`), and free-text. |

Example provenance for a skill distilled from a user's own reviewed sessions:

```json
{
  "source": "instinct:evolved",
  "source_type": "inferred",
  "confidence": 0.82,
  "untrusted": false,
  "retrieved_at": "2026-06-17T00:00:00Z",
  "note": "Distilled from approved follow-up-cadence instincts."
}
```

### The untrusted gate

This is the load-bearing rule. **Content with `untrusted: true` is never
auto-acted upon, and an instinct never auto-forms from untrusted prospect
content.** Prospect emails, websites, attachments, and transcripts are data to
quote and score, not instructions to learn from. If a candidate skill or
instinct traces back to untrusted content, it stays behind human review
(`/instinct-status`) and is not promoted into the curated catalog until a
person has vetted it. Provenance is what makes that gate enforceable rather than
aspirational.

## 4. Placement decision -- quick guide

- Reviewed, sales-team-wide, belongs in the shipped plugin, a command should be
  able to call it -> **curated** (`skills/<name>/SKILL.md`), authored to the
  development guide and validated by CI.
- Personal or team pattern that emerged from your sessions -> **learned**
  (`~/.claude/skills/*`) via the instinct path, with provenance.
- Came from a teammate's export -> **imported**, with provenance preserved.
- A learned skill you now want shipped and CI-guaranteed -> copy it into
  `skills/`, raise it to standard, attach provenance, and let CI validate it.
  Then run `npm run catalog:write` so the count stays pinned.

---

ESCC is adapted from Everything Claude Code (ECC) by Affaan Mustafa --
https://github.com/affaan-m/ECC -- used under the MIT License.
