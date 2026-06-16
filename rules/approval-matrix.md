# Approval Matrix

Who must approve a non-standard deal term before it is offered to a customer. Source of truth for `deal-desk`, `quote-desk`, and `/deal-desk`. Approvals are gated at the hook boundary and audit-logged, not granted on trust.

## Discount / term tiers
| Discount (off list) | ACV band | Approver |
|---|---|---|
| ≤ 10% | any | Rep (self-serve, logged) |
| 10–20% | < $50k | Sales Manager |
| 10–20% | ≥ $50k | Sales Manager + RevOps |
| 20–35% | any | VP Sales |
| > 35%, or non-standard terms | any | CRO + Finance |

> Bands are a starting template — a team calibrates the discount/ACV thresholds in its workspace config. The escalation *shape* (rep → manager → VP → CRO+Finance) is the durable part.

## Non-standard terms
- Custom legal redlines (MSA/DPA), unusual payment schedules, ramp deals, free periods, and multi-year commitments above band always escalate one tier.
- Anything touching revenue recognition routes to Finance.

## Process
- Approval requests run intake → matrix → approve/deny/escalate with an **audit log** (`deal-desk`). `governance-capture` records `approval_requested`.
- No term is offered to a customer before its required approval is recorded. When in doubt, escalate.
