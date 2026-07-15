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
| Skills | 69 |
| Agents | 18 |
| Commands | 71 |
| Rules | 24 |
| Hook matchers | 30 |

_Counts are generated and CI-pinned by `npm run catalog:write`. Do not edit by hand._
<!-- ESCC:CATALOG:END -->

## Configuration

All runtime configuration is exposed through `ESCC_*` environment variables. See [`.env.example`](.env.example) for the full surface and defaults.

Two settings matter most:

- **`ESCC_HOOK_PROFILE`** — selects the active hook profile: `minimal`, `standard` (default), or `strict`. Combine with `ESCC_DISABLED_HOOKS=<id,id>` to drop individual hooks.
- **The outbound send-gate** — `pre:outbound-send-gate` **fails closed**, and (since v1.1.0) enforces at the **tool boundary**: it blocks a Gmail draft, any live send, and a HubSpot OUTBOUND email engagement until a per-recipient **approval token** (`recipient + content hash`) is recorded — so a drifted agent calling the MCP tools directly is still gated. The token is written by the blessed path (`email-outbound-ops` for one message, `/escc-worklist` for a batch) only after the four outbound gates pass: timing/do-not-contact, claim-vs-record (fabrication firewall), WIIFM, and contactability. HubSpot tasks/notes/deals/reads are never blocked. Bulk sends are capped by `ESCC_BULK_SEND_MAX` (default 5/session); default is block, with a logged `override: <reason>`. Every other hook fails open. `ESCC_OUTBOUND_GATE=off` exists only as a documented, dangerous escape hatch. See [`rules/common/outbound-gates.md`](rules/common/outbound-gates.md).

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

**v1.10.0.** **The A-Z attack plan — and an opt-out the hooks actually enforce** (see [docs/releases/v1.10.0.md](docs/releases/v1.10.0.md), [ADR-0021](docs/DECISIONS.md)): name one target business and **`/attack`** runs the whole play — a do-not-contact/contactability screen first, the read-only research agents fanned out in parallel across an A–P rubric, then a sequenced multi-channel **plan of attack** whose first touches land in the gated draft path. An inbound **opt-out is now hook-enforced end-to-end**: the new **`escc dnc`** verb writes the local blocklist the fail-closed send-gate reads (`opt-out-handling` runs it FIRST, before the CRM flag; `dnc clear` refuses without documented re-consent evidence), the gate screens **every** addressee — display-name forms and comma lists included — plus each one's canonical account, and a garbled timing block fails CLOSED instead of silently expiring. A full review-hardening sweep closed the rest: the MCP health probe no longer misreads spec-compliant stdio servers as dead (it speaks JSON-RPC `initialize` now, and a healthy probe returns in milliseconds instead of a guaranteed 5-second stall), `skills/worklist` and the new attack plan actually ship in profile installs (neither was claimed by any install module), raw NUL bytes that made the outbound review engine invisible to `grep`/`file` were purged and permanently banned, and **five new or extended CI guards** pin it all — version-consistency across the seven release surfaces, the 800-line machinery cap, manifest disk→module completeness, raw-control-character detection, and an emoji drift ratchet. 699 tests (from 671). **v1.9.1.** **The adversarial reviewer is enforced — and a batch actually routes** (see [docs/releases/v1.9.1.md](docs/releases/v1.9.1.md), [ADR-0020](docs/DECISIONS.md)): a field test (bulk-drafting ~38 emails via a hand-rolled loop) showed the fail-closed send-gate holding perfectly while the `outbound-reviewer` was skipped and the batch never reached `/escc-worklist`. Now `escc outbound approve` mints a per-recipient token only when an adversarial-review verdict clears the confidence floor **in addition to** the four gates (stamped on the token for audit) — the `pre:outbound-send-gate` hook is untouched, only the token's *meaning* tightens at mint time, so a token is harder to earn and never easier (`--override` and `ESCC_OUTBOUND_REQUIRE_REVIEW=off` are the logged escape hatches). And a batch ask ("mass-draft 38 emails", "these 25 contacts") now routes to the `worklist` on-ramp instead of the single-message skill, with a post-draft nudge toward `/escc-worklist` and an explicit "don't hand-roll with general-purpose agents" rule. **v1.9.0.** **The digital twin — learn the rep automatically** (see [docs/releases/v1.9.0.md](docs/releases/v1.9.0.md), [ADR-0019](docs/DECISIONS.md)): ESCC now learns from real work instead of manual filling — all in-session and behind the existing human gates, with the fail-closed send-gate untouched and `crm-operator` still the sole CRM writer. The **prepared day**: the first `/daily` runs an in-session morning sweep (batch `escc reconcile`, `escc worklist`) that pre-stages today's meetings and briefs as **structured-only** work items — no prospect free text is ever persisted or re-injected across sessions. The **style loop** keeps each account's voice overlay current from the buyer side of threads/transcripts, with a downgrade guard + `.bak` backup so a thin refresh can't erode a high-confidence profile. The **knowledge loop** auto-mines objections/pains from every processed call into the operator-only candidate area (ADR-0012 firewall intact; `product mine --from-transcript` now refuses quarantined paths and ingestion is capped). The **outcomes loop** self-feeds — `inbox-triage` auto-attests replies with thread-level dedupe — and any bad row rolls back everywhere via **`escc outcome void`**. Plus **`escc twin`** (what the twin learned lately + where to correct each), and a **privacy-purge** that now reaches every learning store, CI-guarded so no future store can escape erasure. Fidelity instrumentation and machine-written resonance are speced for a follow-up. **v1.8.1.** **Public-source hygiene** (see [docs/releases/v1.8.1.md](docs/releases/v1.8.1.md)): a full-repo sensitivity audit plus un-regressable guards — every fixture identity moved to IANA-reserved domains (`.example`/`.test`) that cannot be real, a new committed-email CI guard, all public-source scanners widened to every git-tracked file (scope-pinned), and the banned-company-token list shipped as sha256 hashes so the source never names what it bans. No behavior changes. **v1.8.0.** **The source-of-truth release** (see [ADR-0018](docs/DECISIONS.md)): one **canonical account identity** joins every store ("Example Co" = "example-co.example" = `company:<hubspot-id>`; `escc identity link|backfill` heals historical fragments reversibly), the **learning loop is fed** (deal-stage writes, booked meetings, and rep corrections now land in the ledgers that move instinct confidence — previously fully built but starved), and **"HubSpot wins" is code** (`escc reconcile` diffs and syncs memory to a live CRM snapshot). New surfaces: **`escc truth <account>`** (+`/truth` skill) — the provenance-labeled account picture; **`escc audit`** — compliance-grade governance queries; **separation-of-duties** manager-signed overrides under strict (tighten-only); **scheduled autonomy** (`escc watch --install-schedule`, `escc notify drain`); and **currency-correct money math** (mixed-currency sums refuse, never guess). **v1.7.1.** Full-run hardening: a 66-check machine pass + three audits over the whole plugin; fixes a SessionStart bootstrap that could silently run a **stale installed copy's** hydration, a chaining-hints false positive ("Dealify" ≠ a deal), an intent-router cache bleed, and brings `.env.example` + the contributor guide in line with the code (see the [changelog](CHANGELOG.md)). **v1.7.0.** **First-run that can't fail silently + the funnel gaps closed**: `configure-escc` is now a setup doctor — it checks the MCP stack against reality (HubSpot/Gmail required), verifies installs with `escc doctor`, and offers first-run seeding (vocab, voice via `/ingest`, optional persona routing focus) — and a new **`enrichment-ops`** skill (`/enrich`) finally orchestrates wired enrichment MCPs (Apollo/Clay, web fallback) with per-field provenance and review-pack-only writes via `crm-operator`. Plus: renewal-window triggers in `trigger-detection`, a pending-approvals board in `deal-desk`, and a proactive referral play in `follow-up-ops` (see [ADR-0017](docs/DECISIONS.md)). **v1.6.0.** The **agentic routing core**: skills now auto-invoke reliably instead of waiting for slash commands. All 66 skill descriptions are compressed to fit the harness's routing budget (39k → 12.6k chars, CI-pinned so it can never regress), a deterministic **intent-router** hook suggests the right skill at prompt time ("they replied…" → `escc:reply-handling`), a **chaining-hints** hook proposes the next play after a high-signal tool result (transcript → `discovery-notes`, deal read → `deal-review`; once per family per session), and session start teaches `/daily`. Both hooks are pure hints that fail open — no enforcement surface changed (see [ADR-0016](docs/DECISIONS.md)). **v1.5.0.** Per-account **tone-match**: a new deterministic per-account voice overlay (`escc voice account`) layers on the rep's base `[VOICE PROFILE]` so a draft mirrors how a specific account writes — their register and recurring vocabulary — stored gitignored at `.claude/escc/voice/account/<account>.md`. It is **STYLE only by construction**: the mirrored lexicon borrows the buyer's words, never their claims or numbers (a metric can never become a term), and facts still come only from approved product-knowledge (see [ADR-0015](docs/DECISIONS.md)). **v1.4.0.** A new **`/ingest`** wizard drag-and-drops existing knowledge into the right layer — sent emails into the brand-voice profile, a call transcript into `discovery-notes` plus objection/pain candidates, a case study or pricing doc into product-knowledge candidates, a competitor doc into a battlecard candidate, and an ICP list into segment suggestions — reusing existing surfaces, with untrusted content read only by a read-only quarantine subagent and every product claim held as an operator-reviewed candidate until a human approves it (see [ADR-0014](docs/DECISIONS.md)). **v1.3.0.** ESCC is now **company-neutral by construction** — the controlled vocabulary ships as a generic cross-industry template with a per-workspace override (`escc product vocab init`), and two CI guards block any brand name or credential from being committed, so any sales team can install it and keep their own data in their gitignored workspace (see [ADR-0013](docs/DECISIONS.md)). **v1.2.0.** Product knowledge is now keyed by buyer **role** (and competitor/stack), not just industry — an objections library, a persona-to-pain map, and committed battlecard data, all behind a **structural candidate/approved firewall**: field-mined material enters as an operator-reviewed candidate that prose-only drafters cannot read, never auto-quoted (see [ADR-0012](docs/DECISIONS.md)). **v1.1.1.** Outbound is enforced at the tool boundary (drafts, sends, and HubSpot outbound-email require a per-recipient approval token). v1.1.1 hardens the runtime so the state-backed machinery and the fail-closed send-gate work even in a plugin install with no `node_modules` (its sole dependency, `ajv`, is now optional), and makes the send-gate non-disableable so it can never silently fail open — see the [changelog](CHANGELOG.md). Surfaces continue to expand.
