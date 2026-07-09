# Outbound Gates — the tool-boundary enforcement protocol

> Base rule (v1.1.0). The enforcement guarantees here are owned by HOOKS and
> CODE, not by prompts: `pre:outbound-send-gate` (fail-closed),
> `scripts/lib/outbound-gates.js` (the four gates), and the per-recipient
> approval token in the state store. A prompt that "says" not to send is not a
> control; the gate is. This rule documents the policy those controls enforce.
> Complements `outbound-compliance.md` (consent / identity / unsubscribe) and
> `selling-principles.md` (no fabrication; nothing claimed sent without proof).

## The rule

**Outbound is fails-closed at the tool boundary.** Creating an outbound artifact —
a Gmail draft, any live-send tool, or a HubSpot OUTBOUND email engagement — is
BLOCKED until a per-recipient **approval token** exists. The token is keyed by
`recipient + sha256(normalized subject + body)` and is written only after the
four gates below pass **and** the adversarial reviewer approves (ADR-0020), or a
logged human override. This holds even when no ESCC skill was invoked: a drifted
agent that calls the tools directly is still gated.

**Not gated:** CRM reads, and internal HubSpot writes — tasks, notes, deals,
property updates. A follow-up *task* is not outbound; never block it. Only an
OUTBOUND email engagement is gated on the HubSpot surface.

## The four gates

Each gate returns pass / block (with a reason) and may add a contact or account
to the do-not-contact list. All run on the draft + the contact's gathered CRM
records, with no network call.

1. **Timing / do-not-contact-until.** Scan contact and company history for wait/
   stop signals — "call back in <window>", "contact me in", "not now", "no
   interest at the moment", "unsubscribe", "do not contact". If a window has not
   elapsed (vs today), BLOCK and record a not-before date. *A contact who said
   "call back in six weeks" must not get an email now.*
2. **Claim-vs-record (the fabrication firewall).** Every claim about what the
   contact said / asked / agreed — "you asked", "as you requested", "you agreed",
   "as discussed", "you mentioned" — must trace to a verbatim note or call. If
   unsupported, or the records conflict, BLOCK and quote the conflicting record.
3. **WIIFM.** The opener must lead with the recipient's benefit, not the product,
   logistics, or "let me show you a comparison". Enforced hardest for prospects
   with no prior engagement; otherwise returned for rewrite.
4. **Contactability.** No prospecting outbound to accounts that are open-deal /
   demo-booked / handed-to-AE / existing-customer / previously-declined. Derived
   from HubSpot lead_status, open deals, lifecycle, and history; the blocked
   account is written to the do-not-contact list.

A cheap subset (overclaim scan + WIIFM opener heuristic) re-runs inside the
fail-closed hook on the raw payload as a final backstop; the heavy, history-based
judgement happens earlier, in the blessed path.

## The blessed path

The sanctioned way to produce outbound:

- One message: `email-outbound-ops` — gather records, run the gates + the
  adversarial `outbound-reviewer`, then `escc outbound approve --input draft.json`.
- A batch: `/escc-worklist` — triage → research → draft → gates + reviewer → ONE
  consolidated review-pack → on approval, gated send → logged activity.

On a clean pass the approval token is recorded and the send-gate allows the
artifact. The adversarial reviewer is **required, not optional** (ADR-0020): its
verdict is passed to `outbound approve` (`--review-verdict approved
--review-confidence <=1`, or `review:{...}` in the JSON), and the token does not
mint without an approval at or above the confidence floor. The reviewer defaults
to reject when uncertain. `ESCC_OUTBOUND_REQUIRE_REVIEW=off` falls back to the
legacy four-gates-only behavior for a deliberate, supervised exception.

## The do-not-contact list

A small blocklist (`do_not_contact` table) keyed by a normalized contact email or
account id, with a reason and an optional not-before date. The timing and
contactability gates write to it; the send-gate reads it on every gated outbound
and **a blocklist hit beats an approval token** — a blocked recipient is never
contacted even if a token exists. Entries are erasable via `escc privacy-purge`.

## The override

Gates inform; they do not trap. A human may proceed past a block with an explicit,
logged reason:

```bash
escc outbound approve --input draft.json --override "CFO asked for this email today (call 2026-06-22)"
```

The override records the approval token WITH the reason (audited in
`governance_events`) and does not persist the gate's blocklist write. **Default is
block.** Never silently send around a gate; an override is deliberate and named.

## Anti-patterns

- Looping a raw send/draft tool over a list to "save time" — that is the bypass
  these gates exist to close. Every send goes through approve → the send-gate.
- Treating a draft as harmless because "it's just a draft" — a draft is the
  artifact a human then sends; it is gated.
- Blocking a normal CRM task/note/deal write as if it were outbound — it is not.
- Auto-approving to clear a backlog, or overriding without a recorded reason.
