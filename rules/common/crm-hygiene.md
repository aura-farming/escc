# CRM Hygiene

HubSpot is the system of record. These standards keep it trustworthy enough to forecast and coach from. All writes go through the `crm-operator` agent only; this file defines what "good" looks like.

## Required fields by stage
- Every open deal has: amount, close date, stage, a next step **with a date**, and an identified champion/primary contact.
- Stage advances require the destination stage's exit criteria to be met and recorded (`rules/lifecycle-stages.md`). `pre:crm-write-guard` warns/blocks a stage advance with no next step.
- Contacts carry role/title and a lawful-basis/source field (`data-handling`, `lawful-basis`).

## Activity logging
- Log every meaningful interaction (call, meeting, email thread, demo) against the contact and deal — promptly, ideally same day. `post:crm-log-reminder` nudges this after a meeting, draft, or transcript fetch.
- "Log-activity-after-meeting" and "log-call-disposition-after-dial" are default behaviors (seed instincts).

## Naming & structure
- Consistent deal naming: `[Account] — [Use case/Product] — [New|Renewal|Expansion]`.
- Associate contacts ↔ companies ↔ deals correctly. An orphaned deal or contact is a data-quality defect.

## Dedupe-first
- Before creating a company/contact, search for an existing record (`dedupe-merge`). Never create a duplicate; merge with survivorship + association preservation.

## Anti-patterns
- No "happy ears" stage advances without evidence. No close-date sandbagging or pull-ins the deal cannot support. No bulk field edits without a `crm-operator` review pack.
