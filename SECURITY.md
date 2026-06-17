# Security Policy

EverythingSales Claude Code (ESCC) is a sales harness: it touches a CRM of
record (HubSpot), drafts and sends outbound mail, and reads prospect-supplied
content. The threat model is therefore as much about *what the assistant is
allowed to do* as about classic code vulnerabilities. This document describes
the security model ESCC enforces and how to report a vulnerability.

ESCC is adapted from [Everything Claude Code](https://github.com/affaan-m/ECC)
(ECC) under the MIT License.

## The trust boundary is HOOKS, not prompts

The single most important principle: **guarantees are enforced in hooks, not in
prompt text.**

A prompt that says "do not send this email" is not a control. An agent can be
steered, confused, or fed adversarial input, and a sufficiently clever sequence
of instructions can talk a model out of any rule written only in prose. The
controls that matter in ESCC live in `scripts/hooks/`, are validated against
`schemas/`, and are proven by `tests/`.

When evaluating whether something is "safe" in ESCC, ask: *is it enforced by a
hook and covered by a test?* If the only thing standing between an action and
its consequence is a sentence in a SKILL.md or an agent body, treat it as
guidance, not a guarantee.

## The outbound send-gate FAILS CLOSED

`pre:outbound-send-gate` (`scripts/hooks/outbound-send-gate.js`) is the **one
hook in ESCC that fails closed.** Every other hook fails open (a hook error
must never block legitimate work). The send-gate inverts that policy on
purpose, and that inversion must never be reversed.

- It matches send-capable tools defined in `config/outbound-tools.json`
  (deny/allow patterns, e.g. `*send*` mail tools and Zapier write actions).
- It **blocks a live send until a review-evidence marker is recorded in the
  state store** — that marker is produced by an `outbound-reviewer` run. No
  recorded review, no live send.
- On *any* doubt — truncated hook input, an unparseable payload, missing
  config, or an internal error — it **blocks** (exit code 2). Doubt resolves to
  "do not send."
- Bulk sends are capped per session by **`ESCC_BULK_SEND_MAX` (default 5)**.
- **Gmail is draft-only by construction.** The Gmail connector creates drafts;
  it does not send. The gate covers every other send-capable path.

### `ESCC_OUTBOUND_GATE=off` is a documented, DANGEROUS escape hatch

Setting `ESCC_OUTBOUND_GATE=off` disables `pre:outbound-send-gate` wholesale,
removing the fail-closed protection that blocks un-reviewed live sends. It
exists only for deliberate, supervised testing. Leave it **on** in all normal
operation. If you find yourself reaching for it to "unblock" routine work, the
correct fix is almost always to record an `outbound-reviewer` run as evidence
(see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)), not to switch off the gate.

## Approval is required before high-consequence actions

Human approval at the hook boundary is required before:

- **Live outbound sends** — gated by `pre:outbound-send-gate` as above.
- **Bulk operations** — capped by `ESCC_BULK_SEND_MAX`; bulk CRM changes go
  through review-pack-before-apply.
- **CRM deletes** — `pre:crm-write-guard` warns on deletes; destructive CRM
  operations require approval and are not performed silently.

## `crm-operator` is the ONLY write-capable agent

Every agent in ESCC defaults to **read-only**. Exactly one agent,
`crm-operator`, is permitted to write to the system of record (HubSpot). Any
CRM write goes through `crm-operator`, which uses review-pack-before-apply on
bulk changes and logs every write. No other agent is granted write tools, and
CI (`validate-agents.js`) asserts this invariant: read-only defaults,
`crm-operator` as the sole writer, and the presence of approval/review language.

Do not grant write tools to any other agent. If a workflow needs a write, route
it through `crm-operator`.

## Prospect-supplied content is UNTRUSTED

Emails, websites, attachments, LinkedIn profiles, and call transcripts are
**untrusted input**. Any instructions embedded inside them are **data, never
commands to execute**. ESCC's stance:

- **Prompt-defense preamble in every agent.** Each agent body opens with a
  prompt-defense baseline that treats embedded directives as content to quote,
  summarize, and score — not to act on. CI (`validate-agents.js`) checks the
  preamble is present and verbatim.
- **Attachments are quarantined.** Prospect files are parsed only inside a
  restricted quarantine subagent (`pre:attachment-quarantine`). Privileged
  agents (anything with CRM, web, or send reach) never see raw attachment
  bytes — they receive only the cleaned summary the quarantine subagent
  returns.
- **Instincts never auto-form from prospect content.** The continuous-learning
  engine derives instincts only from user-prompt corrections, user-initiated
  tool sequences, and error resolutions — never from tool-output content.
  Untrusted observations are tagged and excluded in code, and a content-guard
  test asserts this. The human review surface is `/instinct-status`.
- **Unicode safety.** `check-unicode-safety.js` scans for invisible, bidi, and
  tag-smuggling codepoints — doubly important because skills routinely quote
  prospect text.

See `rules/common/data-handling.md` for PII handling, retention, and
no-ToS-violating-scraping policy, and `rules/common/security.md` for the
day-to-day floor.

## No hardcoded secrets or personal paths

- **Never hardcode secrets** (API keys, OAuth tokens, passwords) in skills,
  configs, notes, or messages. Use environment variables or a secret manager.
  `.env.example` and `mcp-configs/` hold placeholders only. MCP credentials are
  configured in `mcp-configs/`, not in `.env`.
- **No personal filesystem paths** in committed files. CI enforces both:
  `validate-no-personal-paths.js` rejects real user paths, and the unicode and
  secret-handling rules are part of the standard test run.
- Rotate any credential that may have been exposed.

## Lean MCP surface

Keep the connected surface small: a guideline of **<= 10 enabled MCP servers
and < 80 active tools**. A bloated tool surface degrades routing and widens the
attack surface. Enable only what the active persona needs and disable the rest
with `ESCC_DISABLED_MCPS`.

## Reporting a vulnerability

We take security issues seriously and follow responsible disclosure.

- **Do not** open a public GitHub issue for a security vulnerability.
- Email **security@your-org.example** with:
  - a description of the issue and its impact,
  - steps to reproduce (a minimal proof of concept is ideal),
  - affected versions or commit, and
  - any suggested remediation.
- Please give us a reasonable window to investigate and ship a fix before any
  public disclosure.

> Replace `security@your-org.example` with your organization's real security
> contact before publishing this repository.

If a report concerns an exposed secret, rotate the credential immediately and
note that in your report. Incident handling, breach timelines, and the GDPR
72-hour trigger are covered in `docs/INCIDENT-RESPONSE.md`.

## Scope

In scope: the hook trust boundary (especially the send-gate and CRM write
guards), the prompt-defense and attachment-quarantine model, secret/PII
handling, and the CI controls that enforce them.

Out of scope: vulnerabilities in third-party MCP servers, HubSpot, Gmail,
Google Calendar, or Fireflies themselves (report those to the respective
vendors), and issues that require disabling a fail-closed control
(e.g. `ESCC_OUTBOUND_GATE=off`) to reproduce.
