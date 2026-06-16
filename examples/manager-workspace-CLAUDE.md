# Workspace — Acme Co (Sales Manager / RevOps)

<!-- Example workspace CLAUDE.md for a manager / RevOps seat. Copy + replace placeholders. -->

## Persona & mode
- Primary persona: **Sales Manager / RevOps**. Default install profile: `sales-manager` (or `revops`).
- Default context/mode: `pipeline-review` (launch via the `claude-manager` alias).

## GTM stack (detected by team-init)
- CRM: **HubSpot** (system of record)
- Transcripts: **Fireflies**
- Alerts: **Slack** (delivery via `notify.js`)
> Mapped to recommended skills/rules/hooks via `config/gtm-stack-mappings.json`.

## Scope
- Team roster + territories: `<pointer>` (`rules/routing-rules.md`).
- Quota / ramp / activity targets: `rules/targets.md` (calibrate the numbers in team config).

## Forecast & methodology
- Forecast definitions: `rules/common/forecasting-definitions.md`; risk-weighting `rules/meddpicc/forecast-risk.md`.
- Approval authority: `rules/approval-matrix.md` (you are an approver tier).

## Guardrails (do not weaken)
- Inspection is evidence-based, not happy-ears. Read-only by default; CRM changes are reviewed `crm-operator` actions.
- Activity data is a coaching input, not surveillance (`rules/targets.md`).
- Manager-gated instinct promotion only (`/instinct-promote`); review the queue at `/instinct-status`.
