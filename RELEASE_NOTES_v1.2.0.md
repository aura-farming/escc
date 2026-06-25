# ESCC v1.2.0 — persona/role-keyed knowledge, behind a structural firewall

**Drafting can now write to a contact's role and stack, not just their industry —
and the fabrication firewall comes out stronger, not weaker.**

## Why

ESCC's approved product-knowledge store was keyed only by free-text `segment`, and
retrieval lived in prose inside the drafting skills. So a cold email to a CFO and one
to a store manager pulled the same industry proof, there was no stored objections
library or persona-to-pain map, and competitor battlecards had no committed schema or
seed. This release adds a buyer-**role** dimension (and competitor/stack), an objections
library, a persona-to-pain map, and committed battlecard data — while making the
"no approved proof, say so" firewall a structural guarantee.

## What's new

- **New types + tags, one taxonomy.** Optional `objection` / `pain` / `battlecard`
  types and `role` / `competitor` tags join `segment`, pinned by the first product-store
  JSON Schema (`schemas/product-knowledge.schema.json`). Everything is optional, so the
  existing entries and every current drafting flow are unchanged.
- **Controlled vocabulary.** `config/knowledge-vocab.json` closes the role / segment
  (industry) / competitor sets and maps a HubSpot `jobtitle` to a role (unknown ->
  `general`, which still returns general proof). Free-text tags are rejected at ingest.
- **A coded retrieval ladder.** `scripts/lib/product-knowledge.js` resolves
  role+segment+competitor -> role+segment -> segment -> general, approved-and-fresh
  only, returning an explicit "no approved proof for <slot>" on a miss (and logging the
  gap) — so a caller says so instead of inventing.
- **Operator CLI.** `escc product retrieve | resolve-role | add | approve | candidates
  | gaps | mine`.

## The firewall (ADR-0012)

The candidate/approved wall is **structural, not prose**. A prose-only drafting agent
(`Read`/`Grep`/`Glob`, no code execution) reads the store file directly, so a "return
approved-only" function it cannot call would degrade to a prompt instruction. A
PreToolUse `Read`-hook cannot strip rows either — it sees only the path, not the bytes.
So: **approved entries live in the one file drafters read; field-mined or inferred
candidates (`approved:false`, `untrusted:true`) live in a separate operator-only area no
drafting skill or agent references or can glob.** An unapproved row is unreachable by
*where it lives*. Promotion to approved is the same human gate the store already used
(`approved_by` set by a person). `readApproved()` defensively drops any tainted row, and
a content-guard threat test pins that no drafting context is pointed at the candidate
store.

## PII

No prospect identity enters the layer by construction — objections are abstracted to a
`pattern`, battlecards assert our differentiation (not claims about a person). Verbatim
quotes and identity stay in `account-memory`, which the privacy purge already reaches;
`privacy-purge.js` is unchanged.

## Deferred (supervised follow-up)

Auto-inferred **resonance** and the **ongoing outcome-fed ingestion loop** are out of
scope — both self-reinforce with multi-causal attribution and are the fabrication
failure mode automated. The `resonance` field ships human-write-only and unwired.

## Upgrade notes

Additive and backward compatible — no migration required. To start using roles,
add a role-tagged entry with `escc product add --approved-by "<name>"`, or re-tag an
existing entry. The full design rationale is in `docs/DECISIONS.md` (ADR-0012) and the
Phase-0 research in `FINDINGS.md`.

---

ESCC is adapted from [Everything Claude Code](https://github.com/affaan-m/ECC) by
Affaan Mustafa, under the MIT License.
