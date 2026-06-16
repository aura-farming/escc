This file extends [common/outbound-compliance.md](../common/outbound-compliance.md) with EU/UK rules (GDPR + PECR). This is ESCC's strictest baseline and the default when jurisdiction is unknown.

# Jurisdiction — EU / UK (GDPR + PECR)

Applies when the recipient is in the EU or UK (`jurisdiction-routing.md`).

## Lawful basis (GDPR)
- Process personal data only with a documented lawful basis — usually **consent** or **legitimate interest** with a balancing assessment (`lawful-basis.md`). B2B legitimate interest is narrower than many assume.
- Honor data-subject rights: access, rectification, and **erasure** (`escc privacy-purge` plus a human CRM action; `data-handling`).

## E-privacy (PECR)
- Electronic marketing to individuals generally requires prior consent; the "soft opt-in" (existing customer, similar products, opt-out offered each time) is narrow.
- Corporate subscribers have more latitude but still require identity + opt-out.

## Identity & opt-out
- Identify the sender; provide an easy opt-out on every message; act on opt-outs and erasure requests promptly.

## Breach
- A personal-data breach may trigger a **72-hour** notification obligation — follow `docs/INCIDENT-RESPONSE.md`.
