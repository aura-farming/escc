# Outbound Compliance

The non-negotiable legal/regulatory floor for ALL outbound (email, LinkedIn, SMS, calls). **This file is protected:** agents may not edit it (`pre:compliance-protection`). Jurisdiction-specific detail lives in `rules/jurisdictions/*` and is selected by `rules/jurisdiction-routing.md`; this file is the common baseline.

## Consent & lawful basis
- Have a lawful basis to contact before the first touch (consent, or where permitted, legitimate interest) and record it. See `rules/lawful-basis.md`.
- **No purchased-list abuse.** Do not blast bought or scraped lists. Cold B2B outreach is permitted only where the jurisdiction allows it AND the message is genuinely relevant to the recipient's role.

## Sender identity
- Every outbound message identifies the real sender and includes a valid physical/postal business address.
- The "from" identity and routing must be accurate and not misleading. No deceptive subject lines, no header spoofing.

## Functional unsubscribe / opt-out
- Every commercial message carries a working, no-cost, low-friction opt-out. Honor opt-outs promptly — jurisdiction deadlines are in the overlays; treat **5 business days** as the safe default.
- Opt-out / unsubscribe requests are processed by `opt-out-handling`. Once a contact opts out they are added to the suppression list and never re-added to a sequence.

## Suppression screening (A.5)
- **Screen every recipient against the suppression list before adding them to any sequence or sending any touch.** A suppressed contact (prior opt-out, DNC, hard bounce, complaint, or legal hold) is never contacted.
- Suppression is global across personas and sequences — a new sequence does not reset it.
- Hard bounces and spam complaints are added to suppression automatically; do not retry them. "Suppression-check-before-sequence-add" is a default behavior (seed instinct).

## Jurisdictions (baseline — detail in overlays)
- **AU — Spam Act 2003 (first-class):** consent (express or inferred), accurate sender identity, functional unsubscribe honored within 5 business days. See `rules/jurisdictions/au.md`.
- **US — CAN-SPAM:** accurate headers and subject, identify promotional mail where applicable, a physical postal address, opt-out honored within 10 business days. See `rules/jurisdictions/us.md`.
- **EU/UK — GDPR + PECR:** lawful basis, data-subject rights, and e-privacy consent rules. See `rules/jurisdictions/eu-uk.md`.

## Enforcement
- The trust boundary is the hook, not this text. `pre:outbound-send-gate` (fail-closed) blocks a live send without a recorded review; `post:outbound-style-check` warns on a missing unsubscribe/identity block in sequences. Bulk sends are capped by `ESCC_BULK_SEND_MAX`.
- When unsure whether a touch is compliant, **do not send** — escalate to a human.
