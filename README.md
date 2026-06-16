# EverythingSales Claude Code (ESCC)

A skills-first Claude Code plugin that turns Claude into a sales co-pilot for SDRs, AEs, Sales Managers, and RevOps — grounded in HubSpot, MEDDPICC, and compliant outbound.

> Adapted from [Everything Claude Code](https://github.com/affaan-m/ECC) (ECC) by Affaan Mustafa, under the MIT License. The harness machinery is ported with attribution; all engineering content is replaced with sales content.

## What is this

ESCC is a Claude Code plugin harness for sales teams. It is **skills-first**: skills (`escc:<name>`) are the canonical workflow surface, commands are thin shims over them, agents are least-privilege, and rules are layered (common → MEDDPICC → segment). Outbound is compliant by construction (AU Spam Act 2003 first-class, plus CAN-SPAM and GDPR/PECR), and the trust boundary lives in **hooks, not prompts**.

### Who it is for

- **SDRs** — prospecting, account research, outbound sequences, cold outreach, follow-ups, objection handling, meeting booking, inbound triage.
- **AEs** — call/demo prep, discovery capture, deal review, stakeholder mapping, mutual action plans, proposals, battlecards, negotiation, RFPs, renewals.
- **Sales Managers** — pipeline hygiene, forecast rollup, deal inspection, coaching, and team-level review.
- **RevOps** — the GTM stack mappings, hooks, and CRM-of-record plumbing that keep the above honest.

## Quick start

Install ESCC as a Claude Code plugin via the local marketplace path:

```bash
# Add the marketplace
/plugin marketplace add aura-farming/escc

# Then install the plugin from that marketplace
/plugin install escc
```

Once installed, skills appear under the `escc:` namespace (for example `escc:prospecting-pipeline`, `escc:deal-review`). Invoke them directly, or let commands and agents route to them.

System of record is **HubSpot** (via MCP). Email and calendar run on **Gmail + Google Calendar** (Gmail is draft-only by construction). Call transcripts come from **Fireflies**.

## Catalog

<!-- ESCC:CATALOG:START -->
| Surface | Count |
| --- | --- |
| Skills | 64 |
| Agents | 18 |
| Commands | 66 |
| Rules | 23 |
| Hook matchers | 26 |

_Counts are generated and CI-pinned by `npm run catalog:write`. Do not edit by hand._
<!-- ESCC:CATALOG:END -->

## Configuration

All runtime configuration is exposed through `ESCC_*` environment variables. See [`.env.example`](.env.example) for the full surface and defaults.

Two settings matter most:

- **`ESCC_HOOK_PROFILE`** — selects the active hook profile: `minimal`, `standard` (default), or `strict`. Combine with `ESCC_DISABLED_HOOKS=<id,id>` to drop individual hooks.
- **The outbound send-gate** — `pre:outbound-send-gate` **fails closed**: it blocks any live send by a send-capable tool until an `outbound-reviewer` run is recorded as review evidence. Bulk sends are capped by `ESCC_BULK_SEND_MAX` (default 5/session). Every other hook fails open. `ESCC_OUTBOUND_GATE=off` exists only as a documented, dangerous escape hatch.

## Persona aliases

ESCC documents CLI persona aliases that preload a working context from `contexts/`:

- `claude-sdr` → `contexts/prospecting.md`
- `claude-ae` → `contexts/deal-work.md`
- `claude-manager` → `contexts/pipeline-review.md`

Each alias injects a mode instruction set so the session starts focused on the right surface. See the getting-started guides under `docs/` for setup.

## License & attribution

MIT License — Copyright (c) 2026 Lucas. See [`LICENSE`](LICENSE).

The harness machinery (hook runtime, session persistence, instinct engine, installer, quality pipeline) is adapted from [Everything Claude Code](https://github.com/affaan-m/ECC) by Affaan Mustafa, used under the MIT License with attribution. Ported files carry an attribution header pointing back to ECC.

## Status

**v0.1.0 — in active build.** Surfaces and the catalog above are still being populated; expect rapid iteration.
