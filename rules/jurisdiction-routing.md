# Jurisdiction Routing

Which compliance overlay applies to a given outbound contact. Selects among `rules/jurisdictions/{au,us,eu-uk}.md` on top of the `outbound-compliance.md` baseline.

## Determining jurisdiction
- Route by the **recipient's** location (where the person is), not the sender's, and not solely company HQ. Use the strongest signal available: stated location, work location, country code, office address.
- When multiple jurisdictions could apply (e.g. a multinational), apply the **strictest** applicable regime.
- When jurisdiction is unknown, default to the strictest baseline (treat as EU/UK consent rules) until confirmed.

## Applying the overlay
- **AU** → `rules/jurisdictions/au.md` (Spam Act 2003).
- **US** → `rules/jurisdictions/us.md` (CAN-SPAM).
- **EU / UK** → `rules/jurisdictions/eu-uk.md` (GDPR + PECR).
- Other regions: apply the common baseline plus the nearest stricter overlay; flag for human review if materially different.

## Recording
- Record the determined jurisdiction and lawful basis on the contact (`data-handling` provenance, `lawful-basis.md`). The choice is auditable.
