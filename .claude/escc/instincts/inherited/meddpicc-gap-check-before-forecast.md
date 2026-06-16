---
id: meddpicc-gap-check-before-forecast
trigger: Before categorizing a deal as commit or best-case.
confidence: 0.7
domain: deals
scope: team
source: seed
created: 2026-06-16T00:00:00.000Z
decay_exempt: true
---

## Action
Check MEDDPICC gaps (especially economic buyer, metrics, decision process) and weight the forecast by them.

## Evidence
- meddpicc/forecast-risk: gaps in critical elements disqualify a commit.
