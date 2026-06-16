# Lawful Basis

The lawful basis to contact and to process a prospect's data must exist BEFORE outreach, and be recorded. Pairs with `outbound-compliance.md`, `jurisdiction-routing.md`, and `schemas/provenance.schema.json`.

## Choosing a basis
- **Consent** — the contact opted in (form, event, explicit request). Strongest; required for EU/UK e-privacy in most cases.
- **Legitimate interest** — B2B outreach relevant to the person's professional role, where permitted and balanced against their rights. Requires a documented balancing rationale.
- **Contract / existing relationship** — a current customer or active evaluation.

## Recording (per-field provenance)
- Store the basis on the contact with its source and date (`data-handling` → provenance: `lawful_basis`, `source`, `retrieved_at`).
- A contact with **no recorded lawful basis is not contactable** — resolve the basis first.

## Limits
- Legitimate interest is not a blanket excuse to cold-blast bought lists (`outbound-compliance`: no purchased-list abuse).
- Neither consent nor legitimate interest overrides an opt-out or suppression entry — **suppression always wins.**
- Data-subject rights (access, erasure) are honored via `escc privacy-purge` plus a human CRM action (`data-handling`).
