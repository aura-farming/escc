---
description: Enrich a contact or company on demand — fill missing fields from wired enrichment MCPs (Apollo/Clay) with web fallback, provenance-labeled, applied via crm-operator.
argument-hint: "<contact email | company name/domain> [fields to fill]"
---

Apply the `enrichment-ops` skill to: $ARGUMENTS

Scope notes:
- Read the HubSpot record FIRST — only the gaps are enriched; human-entered values are never silently overwritten.
- Every field carries source + confidence (verified / reported / inferred); an inferred email is never a send target; unfilled beats invented.
- Output is a review-pack proposal — `crm-operator` applies accepted fields; this command never writes or sends.
