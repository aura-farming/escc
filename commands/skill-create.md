---
description: Mine session history and sent-mail patterns to draft a new ESCC skill file.
argument-hint: "[theme | pattern | skill name hint]"
---

Apply the `instincts` skill to: $ARGUMENTS

Scope notes:
- Mines the current session transcript and sent-mail history for recurring patterns, then drafts a SKILL.md stub.
- Draft lands in a staging path; it requires human review and `npm test` before catalog promotion.
- Skill name, description, and trigger conditions are inferred from patterns — edit before committing.
