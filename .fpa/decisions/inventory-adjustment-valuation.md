---
name: fpa-decision-inventory-adjustment-valuation
description: How Diferença (inter-store stock movement in the real restocking export) is valued in reconciliation, and why no origin-store tracing is attempted.
metadata:
  type: decision
---

# Decision: valuing the inventory adjustment (`Diferença`)

Not a capital-allocation decision (CAPEX/payback/ROI), so the
`investment-decision.md` template doesn't fit — this is an accounting-policy
call: how to value one figure in `finance-service`'s reconciliation output.
Structured per
[`financial-decision-framework.md`](../../.claude/skills/autonomous-retail-cfo/references/financial-decision-framework.md)
instead.

## Decision

`Diferença` — the field in the real restocking export that makes each row's
own quantity arithmetic balance — is valued as its own reconciliation
figure, **`unclassified stock adjustment`**, at **current catalog cost**,
recognized in the **current period only**, with **no attempt to trace the
unit back to the store or month that originally restocked it**. It is never
folded into restocked value, COGS, or real loss.

## Context

This resolves design decision D6 of the
`openspec/changes/align-ingestion-with-real-reports` proposal, and directly
answers a question the user raised while validating that proposal: when a
product returns to stock from an underperforming store, and its original
restocking cost was already recognized, how do we know which store to
reverse that cost from?

## Evidence

Measured against the operators' 7-month export, 89,252 product rows
(FACT, source: `var/exemplos-de-planilhas/agiliz.ai-20260818T230206Z-1-001/`,
extracted 2026-08-18):

- `Qtd. final = Qtd. Anterior + Qtd. abastecida + Remoções + Diferença` holds
  on 100.000% of rows, zero exceptions. `Diferença` is definitionally the
  plug that balances each row.
- `Diferença` ≠ 0 on 1,621 of 89,252 rows (1.82%), net +31,063 to +31,277
  units across the 7 months (two independent tallies).
- 21 distinct store names (`Cliente`) across every month; none resembles a
  central warehouse — there is no "estoque central" node in this data.
- Within one month (April), only 5 of 43 SKUs carrying any `Diferença` show
  both a positive and a negative entry, and even those don't match 1:1
  (e.g. SKU 1013: +3 vs −4). The month's net was +66 units (122 in, 56 out),
  not the ~0 a closed transfer ledger would produce.

The user's own operational explanation (2026-08-18, this conversation) named
three real causes landing in this one field, with no way to distinguish them
from the data: (1) deliberate transfer between stores to avoid loss at an
underperforming location, (2) a self-checkout customer taking a different
item than the one they paid for, (3) data-entry error confirming quantities
in the app. The export carries no reason code for `Diferença`, unlike
removals, which do.

## Financial impact

Valuing every `Diferença` unit as restocked value at the receiving store
would overstate network restocked value — the figure operators reconcile by
hand — by however many units move this way each period. Measured at ~31k
units net over 7 months across ~21 stores; not a rounding difference at that
scale.

## Root cause (of the origin-store question)

The mental model of "reverse the cost from the store that restocked it"
requires unit-level or lot-level cost tracing. The export has no transfer
ID, no lot ID, and — per the pairing test above — no reliable way to even
match an outbound `Diferença` to its corresponding inbound one, let alone
trace either to a historical restocking event. Not implementable with this
data source.

## Options considered

1. **Trace to origin store, reverse its historical restocked value.**
   Rejected — not implementable (no lineage field; pairing fails even
   within one month).
2. **Value at current cost, current period, no tracing.** Chosen.
3. **Ignore `Diferença` entirely.** Rejected in an earlier round — leaves
   stock on the shelf with no accounting for it.

## Recommendation (chosen)

- Restocked value at the sending store, recognized in the month it actually
  happened, is never edited retroactively — the same rule the platform
  already applies to every historical month.
- The receiving store never adds restocked value for an adjustment unit —
  it gets its own figure, valued at current catalog cost (the same source
  COGS and remaining stock already use).
- Because the figure is same-period and uses current cost, it structurally
  cannot double-count or re-touch a prior month's restocked value —
  regardless of which of the three causes produced the row.
- Labeled `unclassified stock adjustment`, not `transfer`: two of the three
  causes are not economically neutral (a self-checkout mismatch is a real
  revenue/shrinkage leak; a data-entry error is a process gap), so
  presenting the figure as a clean transfer would misrepresent it.
- Store/period/SKU combinations with high `Diferença` frequency or
  magnitude should be flagged for manual operational review — not because
  the figure needs correcting, but because a growing pattern is itself the
  finding worth surfacing.

## Cash impact

None from the accounting treatment itself — no cash moves on an inter-store
transfer. Real cash impact, if any, sits inside cause (2): a customer who
took an item without it being sold is lost revenue, currently invisible
inside the `Diferença` line rather than recognized as lost revenue. Worth a
follow-up KPI once this figure is being captured; not part of this decision.

## Risks

- [Risk] Treating all three causes identically hides a growing self-checkout
  mismatch problem inside a "no impact" line → Mitigation: the
  `unclassified` label plus the operational-review flag, so growth in the
  figure is visible even without being able to attribute cause.
- [Risk] A future export version could add a transfer/lot reference, making
  origin tracing possible → Mitigation: current-cost valuation with no
  tracing doesn't foreclose this — a later change could add proper pairing
  without touching how the four core figures are computed.

## Confidence

**High** on "no double-count is possible under this treatment" — follows
directly from the never-retroactive-restocked-value rule already used
everywhere else in the platform (same logic as the historical-cost
stability test in `add-finance-service`).

**Medium** on "this is a mixed bucket, not just transfers" — based on the
user's own operational description, not yet cross-checked against a labeled
sample of real `Diferença` rows (no field exists to check it against, which
is the limitation this decision works around).

## Human's actual call

Confirmed 2026-08-18: agreed no origin-store tracing is needed or possible,
and that current-cost same-period valuation resolves the double-count
concern. Approved via plan-mode review of
`.claude/plans/0-role-and-operating-dreamy-eclipse.md`.

## Outcome

Not yet known — depends on implementation (tasks 8.2/8.5 of
`align-ingestion-with-real-reports`) and on whether flagged high-`Diferença`
stores/SKUs turn out to correlate with a real operational problem once
reviewed.
