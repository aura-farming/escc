# Team-Shared Config — Example Co Co Sales

<!-- Example team-shared CLAUDE.md: the settings every persona inherits. Keep
     workspace-specific identity in the per-seat files; keep shared policy here. -->

## Shared identity
- Company: Example Co Co. Product/value-prop source of truth: the `product-knowledge` skill.
- Brand voice: defined by the `brand-voice` skill from approved samples — all drafting inherits it.

## Shared ICP & segments
- ICP: `<link>` (via `icp-profile`). Segments in use: `enterprise`, `mid-market`, `smb` (`rules/segments/*`).

## Shared compliance (non-negotiable)
- Jurisdictions: AU (first-class), US, EU/UK — `rules/jurisdiction-routing.md` selects per recipient.
- `rules/common/outbound-compliance.md` + `rules/lawful-basis.md` are protected; suppression is global.

## Shared commercial policy
- Lifecycle stages: `rules/lifecycle-stages.md`. Forecast definitions: `rules/common/forecasting-definitions.md`.
- Approval matrix (calibrate bands here): `rules/approval-matrix.md`.
- Targets model: `rules/targets.md`.

## Team instincts
- Shipped seeds live in `.claude/escc/instincts/inherited/` (all `scope: team`, decay-exempt).
- Personal → team promotion is manager-gated (`/instinct-promote`); share via `/instinct-export` + `/instinct-import`.
