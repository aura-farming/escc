# Workspace — Example Co Co (AE)

<!-- Example workspace CLAUDE.md for an Account Executive. Copy + replace placeholders. -->

## Persona & mode
- Primary persona: **AE**. Default install profile: `ae`.
- Default context/mode: `deal-work` (launch via the `claude-ae` alias).

## GTM stack (detected by team-init)
- CRM: **HubSpot** (system of record)
- Email: **Gmail** (draft-only)
- Calendar: **Google Calendar**
- Transcripts: **Fireflies**
> Mapped to recommended skills/rules/hooks via `config/gtm-stack-mappings.json`.

## Sender identity
- Send-as: `you@company.example`
- Reply-to: `you@company.example`

## Methodology & segment
- Methodology: **MEDDPICC** (`rules/meddpicc/*`).
- Primary segment: `enterprise` (overlay: `rules/segments/enterprise.md`) — multi-thread by default.

## Compliance
- Default jurisdiction: **AU** (`rules/jurisdictions/au.md`); routing via `rules/jurisdiction-routing.md`.
- Non-standard terms route through `rules/approval-matrix.md` before reaching a customer.

## Guardrails (do not weaken)
- Every open deal carries a dated next step. All CRM writes go through `crm-operator`.
- Forecast category must survive MEDDPICC scrutiny (`rules/meddpicc/forecast-risk.md`).
