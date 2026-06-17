# The ESCC Compliance Guide

A practical guide for sales reps using ESCC to run compliant outbound. It tells
you the non-negotiable rules, what changes by jurisdiction, and -- most
importantly -- why you cannot accidentally break the worst rules even if you try.

The short version: outbound in ESCC is **compliant by construction**. The real
guarantees live in hooks, not in this prose. A prompt that "says" not to send is
not a control; the send-gate hook is. This guide explains the floor you are
operating on so you understand the guardrails, not so you can talk your way
around them.

> Owner of the floor: `rules/common/outbound-compliance.md`. Jurisdiction detail:
> `rules/jurisdictions/au.md`, `rules/jurisdictions/us.md`,
> `rules/jurisdictions/eu-uk.md`. Lawful basis: `rules/lawful-basis.md`. This
> guide summarises those files for day-to-day use; where they and this guide
> differ, the rule files win.

## The non-negotiable floor

These apply to every outbound touch -- email, LinkedIn, SMS, calls -- in every
jurisdiction. They are the common baseline; jurisdictions add to them, never
subtract.

### 1. Consent or lawful basis -- before the first touch

You must have a lawful basis to contact someone before you reach out, and it must
be recorded on the contact. The bases (`rules/lawful-basis.md`):

- **Consent** -- they opted in (form, event, explicit request). Strongest.
- **Legitimate interest** -- B2B outreach genuinely relevant to the person's
  professional role, where the jurisdiction permits it, with a documented
  balancing rationale. Narrower than people assume.
- **Contract / existing relationship** -- a current customer or active evaluation.

A contact with **no recorded lawful basis is not contactable** -- resolve the
basis first. And **no purchased-list abuse**: do not blast bought or scraped
lists. Cold B2B is only allowed where the jurisdiction permits it and the message
is actually relevant to the recipient's role.

### 2. Accurate sender identity

Every message identifies the real sender and includes a valid physical/postal
business address. The "from" identity and routing must be truthful -- no
deceptive subject lines, no header spoofing. The subject must reflect the
content.

### 3. A functional, low-friction opt-out on every message

Every commercial message carries a working, no-cost, low-friction unsubscribe.
When someone opts out, you honor it promptly -- within the jurisdiction deadline
(below), with **5 business days** as the safe default. Opt-out requests are
processed by the `opt-out-handling` skill: the contact goes on the suppression
list and is never re-added to a sequence.

### 4. Suppression screening -- before every send

**Screen every recipient against the suppression list before adding them to any
sequence or sending any touch.** A suppressed contact -- prior opt-out, DNC, hard
bounce, spam complaint, or legal hold -- is never contacted. Suppression is:

- **Global** -- across all personas and sequences. A new sequence does not reset
  it.
- **Automatic for bounces and complaints** -- hard bounces and spam complaints are
  added to suppression and never retried.
- **Absolute** -- neither consent nor legitimate interest overrides it.
  Suppression always wins (`rules/lawful-basis.md`).

## The jurisdictions

ESCC routes by where the recipient is. When the jurisdiction is unknown, it
defaults to the strictest baseline (EU/UK).

### Australia -- Spam Act 2003 (first-class)

ESCC's first-class compliance jurisdiction (`rules/jurisdictions/au.md`).

- **Consent:** express (opt-in) or inferred (an existing business relationship,
  or a conspicuously published work address relevant to the role -- construed
  narrowly).
- **Sender identity:** accurately identify the sender, with contact details that
  stay valid for at least 30 days.
- **Unsubscribe deadline:** honor opt-outs within **5 business days**; the
  unsubscribe facility must work for at least 30 days after the message.
- Applies to email, SMS, and instant messaging. Penalties are per-message and
  significant -- when consent is uncertain, do not send.

### United States -- CAN-SPAM

Opt-out (not opt-in) for commercial email, but the floor is still mandatory
(`rules/jurisdictions/us.md`).

- **Headers and subject:** accurate "from", "to", and routing; no deceptive
  subject lines.
- **Identification:** identify promotional mail where applicable; include a valid
  physical postal address.
- **Opt-out deadline:** honor opt-outs within **10 business days**. No fee, no
  more than a single step, no demand beyond an opt-out preference. After opt-out,
  do not sell or transfer the address.

### EU / UK -- GDPR + PECR

ESCC's strictest baseline and the default when jurisdiction is unknown
(`rules/jurisdictions/eu-uk.md`).

- **Lawful basis (GDPR):** process personal data only on a documented basis,
  usually consent or a balanced legitimate interest. B2B legitimate interest is
  narrow.
- **E-privacy (PECR):** marketing to individuals generally needs prior consent;
  the "soft opt-in" is narrow. Corporate subscribers have more latitude but still
  require identity + opt-out.
- **Data-subject rights:** honor access, rectification, and **erasure**
  (`escc privacy-purge` plus a human CRM action -- see `docs/INCIDENT-RESPONSE.md`).
- **Breach:** a personal-data breach may trigger a **72-hour** notification
  obligation -- follow `docs/INCIDENT-RESPONSE.md`.

## The send-gate -- why you cannot accidentally blast

This is the part that makes the floor real. The trust boundary is the hook, not
this guide.

### `pre:outbound-send-gate` fails CLOSED

Every other hook in ESCC fails open (a hook error never blocks legitimate work).
The send-gate is the deliberate exception: **on any doubt, it blocks the send.**

- It **blocks a live send** by any send-capable tool **until an
  `outbound-reviewer` run is recorded** as review evidence in the state store. No
  recorded review means no live send. Full stop.
- **Bulk sends are capped** by `ESCC_BULK_SEND_MAX` (default **5** per session).
  You cannot fan out beyond the cap in one go.
- **Gmail is draft-only by construction.** ESCC composes drafts; it does not push
  a live Gmail send. A human reviews and sends.

There is a documented escape hatch, `ESCC_OUTBOUND_GATE=off`, but it exists only
as a dangerous, explicitly-flagged override. Do not use it for routine work, and
never during an incident.

### The compliance baseline is hook-protected

The floor itself (`rules/common/outbound-compliance.md`) is protected by
`pre:compliance-protection` -- **agents cannot edit it.** An agent cannot weaken
the rules and then claim to follow them. The baseline is fixed; the agent works
within it.

This is the core design idea, and it is worth internalising: a prompt instructing
an agent "don't send without review" is not a guarantee -- a clever prompt, a
confused model, or untrusted content in a prospect's email could talk around it.
The send-gate hook is the guarantee, because it runs outside the agent's
reasoning and blocks the action regardless of what the agent "decided".

## What this means for your day

- **Write and queue freely.** Drafting, sequencing, and reviewing are ungated.
  Compose as much as you like.
- **A live send needs a recorded review.** If a send is blocked, it is because an
  `outbound-reviewer` run has not been recorded -- run the review, do not look for
  a workaround.
- **Check the basis before you add a contact.** No recorded lawful basis means the
  contact is not yet contactable.
- **When someone says stop, they are off -- everywhere, immediately.** Route it to
  `opt-out-handling`; it suppresses globally within the deadline. Do not draft a
  sales reply to an opt-out.
- **When in doubt, do not send -- escalate to a human.** That is not just advice;
  it is how the system is built (`rules/common/outbound-compliance.md`).

## Related

- `rules/common/outbound-compliance.md` -- the protected compliance floor.
- `rules/jurisdictions/` -- AU, US, EU/UK overlays.
- `rules/lawful-basis.md` -- choosing and recording a lawful basis.
- `skills/opt-out-handling/SKILL.md` -- inbound unsubscribe / DNC processing.
- `docs/INCIDENT-RESPONSE.md` -- breach triage, the 72-hour GDPR trigger, and
  erasure via `escc privacy-purge`.
- `docs/GLOSSARY.md` -- definitions of suppression list, DNC/opt-out, and the
  terms used here.
