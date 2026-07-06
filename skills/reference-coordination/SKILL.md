---
name: reference-coordination
description: >-
  Match a buyer to approved reference customers and run the intro logistics.
  Trigger: 'can we get a reference', 'customer they can talk to', 'reference
  call'. Approved refs only; protects from over-use.
origin: ESCC
---

# Reference Coordination

A well-matched customer reference can unlock a late-stage deal. A poorly managed one --
wrong customer, wrong use-case, over-asked, or not cleared to be a reference -- damages
customer trust and the deal simultaneously.

> **Governing contracts:**
> `product-knowledge` **owns and approves** all customer references. This skill reads from
> that layer; it does not approve, add, or modify reference entries. Every reference used
> here must have `approved: true` in `product-knowledge` AND a `consent_level` that permits
> the requested use. Entries with `approved: false` or a stale `last_verified` are not
> used.
> `stakeholder-mapping` identifies which buyer persona/role needs which type of reference
> (technical, executive, industry peer). This skill reads from it to sharpen the match.

> **Governing rules:** `rules/common/selling-principles.md` (never fabricate claims or
> customer names), `rules/common/data-handling.md` (prospect and customer PII, provenance
> per field), `rules/meddpicc/qualification.md` (reference timing tied to decision criteria
> and competition).

## When to Activate

Activate this skill when:

- A deal is in **Validation/Proof or Proposal/Negotiation** stage and the buyer asks for a
  customer reference or proof point beyond what a case study provides.
- A **technical evaluator or economic buyer** needs to speak with a peer who has deployed
  the product in a similar context.
- `deal-review` shows that **C (Competition)** is tight -- a reference from a company that
  chose us over the same competitor is high-value.
- The rep wants to **proactively offer a reference** as part of the evaluation plan
  (`evaluation-plan`) before the buyer asks.
- A reference call needs to be **prepared** -- pre-call brief, context alignment, and
  scheduling logistics.

Do **not** activate to retrieve proof points for outreach or proposals -- that is
`product-knowledge`'s retrieval workflow. This skill is specifically about matching a
*live reference customer* to a *specific prospect deal* and coordinating the conversation.

## Reference eligibility rules (non-negotiable)

Before any reference is surfaced to the rep or to a prospect:

1. **Must have `approved: true` in `product-knowledge`.** An unapproved customer entry is
   never surfaced as a reference, even if they are a happy customer.
2. **Must have `consent_level` that permits the requested use.** Consent levels:
   - `public`: may be named openly in any context, including proposals and marketing.
   - `reference_call`: approved for a live reference call; may be named in the context of
     a reference request.
   - `case_study_only`: may be cited via the case study document only; do not approach
     them for a live call without re-confirming consent.
   - `internal_only`: name and details for seller use only; never share with the prospect.
   A request for a live reference call requires `reference_call` or `public` consent.
3. **Must honor the `guardrail` field.** A guardrail may restrict use to specific
   segments, personas, or deal stages (e.g. "enterprise-only", "do not use for competitive
   deals", "AE must pre-approve each request").
4. **Must not be over-asked.** Each reference customer is a shared resource. Track how
   recently they were last asked and how many calls they have done this quarter. A
   reference customer who has done three calls this month is at high risk of burnout --
   skip to the next best match.
5. **Must not be implied if not approved.** If a prospect asks "do you work with companies
   like us?" and no approved reference fits that profile, the answer is "let me check what
   reference options I can offer" -- not a fabricated assurance that such a customer exists.

## Workflow

### A. Match a reference to the deal

1. **Read the product-knowledge reference entries.** Pull all entries with `approved: true`
   and `consent_level` of `reference_call` or `public`. Filter out entries with stale
   `last_verified` (beyond `ESCC_MEMORY_RETENTION_DAYS`) -- treat them as unverified until
   re-confirmed.

2. **Read the stakeholder map** (`stakeholder-mapping`) for this deal. Identify which
   buyer role is requesting or would benefit from a reference: a technical peer, an
   executive sponsor, a security/IT decision-maker, a financial buyer. The best match is
   persona-to-persona and use-case-to-use-case, not just segment-to-segment.

3. **Score match quality** on four dimensions:

   | Dimension | Strong match | Weak match |
   |---|---|---|
   | Persona parity | Same or adjacent role/title | Different persona level |
   | Use-case fit | Same primary use-case | Adjacent use-case |
   | Segment fit | Same segment (enterprise/MM/SMB) | Different segment |
   | Competitive relevance | Chose us over same competitor | No competitive overlap |

   Rank available references by total match quality. Do not present a weak match as strong.

4. **Check the reference customer's availability and usage load.** From the
   `product-knowledge` entry (or a `crm-operator` read of the customer's HubSpot
   reference log, if maintained), confirm:
   - They are not currently over-asked (usage-load flag).
   - Their `guardrail` does not restrict this use.
   If the best match is over-asked or guardrail-blocked, move to the next best match.
   If no match is available, say so plainly -- do not fabricate or imply an alternative.

5. **Output the match recommendation** with match quality, consent level, and the guardrail
   to honor. Include a "do not do" note per guardrail.

### B. Prepare the reference request

6. **Draft the internal ask to the reference owner.** Before approaching the reference
   customer, the seller (or CS/Account Management) must ask permission for this specific
   call. Draft this internal ask with:
   - The prospect's industry, role, and use-case (no PII beyond what is needed).
   - The specific question the prospect wants to address.
   - The preferred timeframe.
   This is not outreach to the reference customer -- it is a coordination message to the
   internal owner (CS manager, AE who owns the reference account).

7. **Draft the pre-call brief for the reference customer** (to be shared by the internal
   owner after they agree). The brief covers:
   - What the prospect wants to learn (use-case framing, not product comparison pressure).
   - What NOT to discuss: pricing details, undisclosed roadmap, or any topic outside the
     reference's approved scope.
   - Logistics: duration (keep it short -- 20-30 minutes default), format, attendees.
   - A note that all output here is DRAFT -- the rep or CS owner sends after confirming.

8. **Draft the introduction message** from the seller to both parties, once the reference
   customer has agreed. This is a brief, warm introduction that frames the call for the
   prospect without over-briefing the reference customer or creating pressure.
   All drafts are DRAFT-ONLY; nothing is sent without the rep's confirmation.

### C. Coordinate logistics

9. **Scheduling:** propose two or three time slots (placeholder dates unless the rep
   provides real availability). Do not book a calendar event -- surface the draft ask and
   let the rep confirm and schedule. If the deal has a `mutual-action-plan`, a confirmed
   reference call milestone should appear there.

10. **Log the reference request** (as a draft instruction for the rep to execute via
    `crm-operator` after confirmation): which reference was requested, which prospect deal,
    date of request, outcome. Never claim logged without a tool-result.

11. **Post-call:** after the reference call, remind the rep to log the outcome and thank the
    reference customer (a brief, genuine note -- not a templated blast). The reference
    customer's usage record should be updated to reflect the call.

## Output contract

```text
REFERENCE COORDINATION: <Account> · <Deal stage> · <Date>

MATCH RECOMMENDATION
  Reference: <name or anonymised descriptor per consent_level>
  Consent level: <public / reference_call>
  Match quality: <Strong / Good / Marginal> · <which dimensions drove the score>
  Guardrail: <any restrictions to honor>
  Usage load: <low / medium / high -- based on last_verified call count>
  Fallback: <next best reference if primary is unavailable>

DRAFTS (DRAFT-ONLY)

--- DRAFT: Internal reference request ---
  To: <CS owner / AE on reference account>
  [draft body: prospect context, use-case, timeframe ask]

--- DRAFT: Pre-call brief (for reference customer, once internal ok confirmed) ---
  [brief body: what prospect wants to learn, do-not-discuss items, logistics]

--- DRAFT: Introduction message (once reference customer agrees) ---
  [intro body, framing the call for the prospect]

LOGISTICS PLACEHOLDERS
  Proposed slots: [REP TO CONFIRM REAL AVAILABILITY]
  Duration: 20-30 minutes recommended
  Format: [video / phone]

NEXT STEPS FOR REP
  - Send internal reference request (draft 1) and wait for confirmation.
  - Do NOT approach reference customer directly until internal owner agrees.
  - After call: log outcome to HubSpot via crm-operator; send thank-you to reference.
  - If reference unavailable: <fallback reference or note that no match exists>
```

## Examples

**Match a reference for a competitive deal:**

```text
Deal: Apex Systems · Validation stage · competing vs. LegacyCRM
Buyer need: CFO wants to speak with a peer CFO who chose us over LegacyCRM.

product-knowledge lookup:
  Entry RF-007: CFO at a mid-market B2B SaaS company
    approved: true
    consent_level: reference_call
    use_case: forecast accuracy + pipeline visibility
    switched_from: LegacyCRM
    guardrail: "AE must pre-approve each reference request; no cold outreach to reference"
    last_verified: 2026-05-10 (within retention window)
    usage_load: low (1 call this quarter)

  Entry RF-012: VP Finance at a Series B startup
    approved: true
    consent_level: case_study_only
    → INELIGIBLE for live reference call. Excluded.

Match recommendation:
  Reference: RF-007 (CFO, mid-market SaaS)
  Consent: reference_call
  Match quality: Strong -- CFO-to-CFO, same use-case, switched from same competitor.
  Guardrail: AE must pre-approve. Draft internal ask to CS owner first.
  Usage load: low.

--- DRAFT: Internal reference request ---
  To: CS owner for RF-007
  Hi [name] -- I have an active deal at Apex Systems where the CFO wants a peer
  reference from a company that switched from LegacyCRM. RF-007's profile is a strong
  fit. Would you be willing to make the ask? The call would be 20-25 minutes, at the
  CFO's convenience in the next three weeks. Happy to provide a brief beforehand.
  [DRAFT-ONLY]

No contact to the reference customer until CS owner confirms.
```

**No approved reference fits the request:**

```text
Prospect: asking for a reference at a healthcare company with HIPAA compliance use-case.

product-knowledge lookup:
  No approved reference with consent_level: reference_call and healthcare/HIPAA use-case.
  RF-003: healthcare company, approved: true, consent_level: internal_only. INELIGIBLE.
  RF-015: compliance use-case, approved: true, consent_level: reference_call, segment: enterprise.
    Guardrail: "enterprise-only; do not use for SMB or MM deals."
    Apex Systems is mid-market. GUARDRAIL BLOCKS.

Result: NO ELIGIBLE REFERENCE for this specific request.

Output to rep:
  No approved reference currently available for a HIPAA/healthcare peer call at this
  segment. Options:
  1. Use case study CS-2026-019 (healthcare outcomes, public) as written proof in place
     of a live call.
  2. Ask product-knowledge owner to check if RF-003 can have consent upgraded for
     reference calls.
  3. Do not imply a healthcare reference exists -- say "let me check our current reference
     availability" and follow up with the above alternatives.
```

## Anti-patterns

- **Surfacing an unapproved reference.** Naming a customer who has `approved: false` or
  `consent_level: internal_only` to a prospect, even casually ("we work with companies
  like X"), is a consent violation and a fabrication risk. Check approval before saying
  anything.
- **Implying a reference exists when none is eligible.** "I'm sure we can find someone"
  without a confirmed approved match is a false assurance. Say no match is available and
  offer case study alternatives.
- **Over-asking a reference customer.** High-value reference customers burn out quickly.
  If usage load is high, skip to the next match or delay the ask. A burned reference
  customer stops being a reference.
- **Approaching the reference customer without internal owner approval.** Always go through
  the CS owner or AE on the reference account. Cold-approaching a customer for a reference
  without coordination damages the customer relationship.
- **Using a guardrail-blocked reference.** A guardrail is a hard constraint, not a
  suggestion. Enterprise-only means enterprise-only. Competitive-use restricted means the
  reference should not be used when the prospect is evaluating that competitor.
- **Claiming the intro or call was scheduled without a tool-result.** All output is drafts
  and proposals. A reference call is confirmed only when both parties have agreed and a
  calendar event exists -- not when you produced a scheduling draft.
- **Sharing the reference customer's PII beyond what the consent level allows.** Treat the
  reference customer's name, company, title, and contact details per `data-handling.md`.
  Under `reference_call` consent, share enough for the prospect to know a peer call is
  available; share details only after the reference customer agrees to the introduction.

## Related

- `product-knowledge` -- owns and approves all reference entries; this skill reads from it
  and honors every guardrail; it never modifies or bypasses the approval layer.
- `stakeholder-mapping` -- identifies which buyer persona needs what type of reference;
  drives the persona-parity dimension of match scoring.
- `evaluation-plan` -- a reference call is often a milestone in the evaluation plan;
  coordinate with it on timing and success criteria.
- `mutual-action-plan` -- a confirmed reference call milestone can appear in the MAP.
- `rules/common/selling-principles.md` -- never fabricate customer names or claims;
  evidence-first; no false completion.
- `rules/common/data-handling.md` -- PII care and provenance for customer reference data.
