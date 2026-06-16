# Meeting Standards

Prep → run → recap → next-step discipline for every customer meeting. Used by `call-prep`, `demo-prep`, `meeting-booking`, `meeting-followthrough`, and `discovery-notes`.

## Before
- No customer meeting without prep: attendees and roles, account/deal history (HubSpot first), the goal of THIS meeting, MEDDPICC gaps to probe, and a talk track. `call-prep`/`demo-prep` produce this.
- Confirm the meeting and send an agenda; reduce no-shows with a confirmation touch ("confirm-meeting-before-meeting" seed).

## During
- Capture decisions, stakeholders, pain, metrics, timeline, and explicit next steps. Discovery is structured by the methodology overlay (`meddpicc/qualification`).

## After — recap + next step
- Send a recap with agreed next steps and owners, promptly.
- Log the meeting and its outcome to HubSpot (`crm-hygiene`); update MEDDPICC fields via `crm-operator`.
- **Every open deal leaves a meeting with a scheduled, dated next step** ("next-step-on-every-open-deal" seed). No "I'll follow up sometime."
- A no-show triggers the recovery play, not silence ("no-show-recovery" seed).
