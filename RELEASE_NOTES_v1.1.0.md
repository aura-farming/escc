# ESCC v1.1.0 — outbound enforcement + batch worklist

**Outbound safety now enforces at the tool boundary, not just at the skill boundary.**

## Why

ESCC's outbound safeguards were advisory: the reviewer and send-gate only ran when
someone deliberately invoked an ESCC skill. An agent told to "use escc" to work a
long task list could drift off the harness, call the Gmail/HubSpot MCP tools
directly, and create dozens of unreviewed drafts and CRM writes — making the exact
mistakes ESCC exists to prevent, with no gate firing. v1.1.0 moves the trust
boundary to the tools themselves.

## What's new

- **The fail-closed send-gate now gates the draft, too.** Creating a Gmail draft —
  or a HubSpot OUTBOUND email engagement, or any live send — is blocked until a
  per-recipient **approval token** (`recipient + content hash`) exists. A drifted
  agent calling the tools directly is still stopped.
- **Four outbound gates** decide whether that token is written:
  - **Timing / do-not-contact-until** — honors "call back in six weeks", "not now",
    "unsubscribe"; blocks until the window elapses.
  - **Claim-vs-record (fabrication firewall)** — "you asked", "as discussed" must
    trace to a real note; unsupported or conflicting → block.
  - **WIIFM** — the opener must lead with the recipient's payoff, not the product.
  - **Contactability** — no prospecting into open-deal / demo-booked / handed-to-AE
    / customer / previously-declined accounts.
- **Do-not-contact blocklist** the gates write and the gate reads — a blocklist hit
  beats an approval token.
- **`/escc-worklist`** — the missing on-ramp: hand it a HubSpot overdue-task list (or
  a set of ids) and it runs triage → research → draft → gates + reviewer → ONE
  consolidated review-pack → approved, gated send → logged activity.
- **`escc outbound approve | check | review-pack`** — the deterministic blessed-path
  CLI that mints the approval token after the gates pass.

## Upgrade

```bash
/plugin marketplace update escc && /plugin install escc@escc
```

- **Behaviour change:** outbound now **fails closed** — a draft/send is blocked
  until it passes the gates and a token is recorded. Produce outbound through
  `email-outbound-ops` (one message) or `/escc-worklist` (a batch).
- **Override:** proceed past a gate with a logged reason —
  `escc outbound approve --input draft.json --override "<reason>"`.
- **Unaffected:** CRM reads and internal HubSpot task/note/deal writes are never
  blocked. Only outbound email is gated.

## Breaking changes

None to any API. The one behavioural change is that outbound is now gated (blocked
until reviewed) rather than advisory. A deliberate `0.1.0 → 1.1.0` version jump
(strict semver would make this feature release `0.2.0`).
