# Incident Response

Operator runbook for data incidents in an ESCC workspace: data breaches,
credential exposure, and data-subject erasure requests. This is the procedure to
follow when something has gone wrong with prospect or customer data, or when a
person exercises their right to be forgotten.

> Scope. ESCC is a Claude Code plugin that operates over your CRM (HubSpot),
> mailbox (Gmail), and local stores. It is not your only system of record. This
> runbook covers the ESCC-owned local stores and the actions ESCC can take; your
> organisation's wider breach policy, DPO, and legal counsel govern everything
> beyond that and take precedence.

Backed by `rules/common/data-handling.md` (PII care, provenance, retention),
`rules/lawful-basis.md` (basis and data-subject rights), and the
`escc privacy-purge` CLI.

## First: contain, then decide

The first goal of any incident is to stop the bleeding, not to assign blame.
Before anything else:

1. Stop the activity that may be causing or compounding harm (pause outbound,
   stop a running sequence, revoke a suspect token).
2. Preserve evidence -- do not delete logs or rewrite history while triaging.
3. Notify your security owner / DPO. Severity calls and regulatory clocks are
   their decision, informed by what you find below.

## Incident type 1 -- Data breach

A breach is any unauthorised access to, disclosure of, or loss of personal data
ESCC touches: an exposed export, a misrouted send containing PII, a compromised
mailbox or CRM session, or a leaked local store.

### Triage steps

1. **Identify the data.** What personal data is involved -- names, emails,
   phone numbers, titles, notes? ESCC treats all of these as PII
   (`rules/common/data-handling.md`). Per-field provenance
   (`schemas/provenance.schema.json`) tells you the source and lawful basis of
   each affected field.
2. **Scope the blast radius.** Which subjects, which accounts, how many records,
   which stores (HubSpot, Gmail drafts, account-memory, observations, session
   data, instinct evidence)?
3. **Determine the cause.** Misconfiguration, exposed credential, ToS-violating
   data collection (prohibited by `rules/common/data-handling.md`), or external
   compromise? If a credential is implicated, run Incident type 2 in parallel.
4. **Contain.** Pause outbound (`ESCC_OUTBOUND_GATE` is fail-closed by default --
   leave it on; do not use the `off` escape hatch during an incident). Revoke or
   rotate any implicated secret. Suspend the affected mailbox/CRM session.
5. **Assess notification duty.** Hand the scoped findings to your DPO / security
   owner. For EU/UK subjects this triggers the GDPR clock below.
6. **Record and remediate.** Log what happened, what data, what action taken, and
   the fix that prevents recurrence. Preserve the timeline.

### The 72-hour GDPR notification trigger

A personal-data breach affecting EU or UK data subjects may trigger a **72-hour**
notification obligation to the relevant supervisory authority, starting from when
the breach becomes known (`rules/jurisdictions/eu-uk.md`). This is a regulatory
clock, not an ESCC setting:

- The 72 hours runs from awareness, not from full root-cause. Do not wait for a
  complete investigation to start the notification process.
- Affected individuals may also need to be informed where the risk to them is
  high.
- Whether the threshold is met, and who files, is a decision for your DPO /
  counsel. ESCC's job is to give them an accurate, prompt scope of the affected
  data and subjects.

## Incident type 2 -- Credential / secret exposure

A token, API key, or other secret has been committed, logged, shared, or
otherwise exposed. ESCC never hardcodes secrets -- `mcp-configs/mcp-servers.json` and
`.env.example` hold placeholders only, and CI (`validate-no-personal-paths.js`)
enforces this -- so an exposed secret is an incident to be rotated, not a value
to be edited in place.

### Rotation steps

1. **Revoke first, investigate second.** Invalidate the exposed credential at its
   provider (HubSpot private-app token, Google OAuth client, Fireflies key, etc.)
   so it can no longer authenticate. Revocation stops misuse immediately;
   investigation can follow.
2. **Issue a replacement** from the provider and place it only in your real
   environment configuration (environment variables / a secret manager) -- never
   back into a tracked file. Keep `.env.example` as placeholders.
3. **Purge the exposure.** Remove the secret from any logs, drafts, session
   notes, or history where it leaked. If it reached git history, follow your
   org's history-scrub procedure; do not attempt a workaround that re-exposes it.
4. **Check for misuse.** Review CRM and mailbox activity for actions taken with
   the exposed credential during its exposure window. If prospect data was
   touched, escalate to Incident type 1.
5. **Confirm and log.** Verify the old credential is dead and the new one works,
   then record the rotation (what, when, who, why) without recording the secret
   value itself.

## Incident type 3 -- Data-subject erasure (right to be forgotten)

When a data subject requests erasure (a GDPR right under
`rules/jurisdictions/eu-uk.md` and `rules/lawful-basis.md`), use the
`escc privacy-purge` CLI to remove their data from the ESCC-owned local stores,
then complete the CRM and manual-review steps it reports.

### What `escc privacy-purge <identifier>` does

Run it with an account id, deal id, email, or domain (minimum 3 characters):

```bash
escc privacy-purge acme.example
```

It is **dry-run by default**. The scan is identical in both modes, so the dry-run
output is exactly what a confirmed run will erase. To actually erase, add the
confirmation flag (the deletion-approval gate, per `CLAUDE.md` section 5 --
approval required before deletes):

```bash
escc privacy-purge acme.example --confirm
```

`--yes` is accepted as an alias for `--confirm`.

**Auto-erased (entity-scoped local stores ESCC owns):**

- **account-memory** -- the subject's own `<id>.jsonl` and `<id>.md` files.
- **observations** -- instinct observation rows that reference the subject.
- **instinct evidence** -- evidence lines that reference the subject are scrubbed;
  an instinct whose trigger/action references the subject, or whose only remaining
  evidence was the subject's, is removed wholesale.

**Reported for manual handling (NOT auto-erased, to avoid over-erasing unrelated
subjects):**

- **The HubSpot record itself** -- ESCC never deletes CRM rows. The erasure must
  go through the `crm-operator` agent (the sole write-capable agent) or a human.
- **session-data summaries** that reference the subject among other accounts.
- **other accounts' logs** that merely mention the subject.

Run privacy-purge when no active Claude Code session is writing to the workspace,
so concurrent writes are not lost.

### Retention as a baseline

Separate from on-request erasure, durable stores honor retention windows so data
does not accumulate indefinitely: `ESCC_MEMORY_RETENTION_DAYS`,
`ESCC_OBSERVATION_RETENTION_DAYS`, and `ESCC_SESSION_RETENTION_DAYS`
(0 / off = keep all). See `rules/common/data-handling.md`.

## Who / what / when checklist

| Step | Who | When |
|---|---|---|
| Contain the active harm (pause outbound, revoke token, suspend session) | Operator on duty | Immediately on detection |
| Notify security owner / DPO | Operator on duty | Immediately -- before deep investigation |
| Scope affected data + subjects (use provenance) | Operator + security owner | Within the first hours |
| GDPR breach notification decision (72-hour clock) | DPO / counsel | Within 72 hours of awareness, for EU/UK subjects |
| Revoke and rotate exposed credentials | Operator / admin | Immediately on credential exposure |
| Run `escc privacy-purge` (dry-run, then `--confirm`) | Operator | On a validated erasure request |
| HubSpot record erasure via `crm-operator` / human | CRM owner | After local purge, per the purge report |
| Record incident, remediation, and prevention | Operator + security owner | Before closing the incident |

## Related

- `rules/common/data-handling.md` -- PII care, attachment quarantine, provenance,
  retention, and the purge contract.
- `rules/lawful-basis.md` -- lawful basis and data-subject rights (access,
  rectification, erasure); suppression always wins.
- `rules/jurisdictions/eu-uk.md` -- GDPR + PECR, including the 72-hour breach
  trigger.
- `the-compliance-guide.md` -- the outbound compliance floor and the send-gate.
- `scripts/lib/privacy-purge.js` -- the erasure implementation behind the CLI.
