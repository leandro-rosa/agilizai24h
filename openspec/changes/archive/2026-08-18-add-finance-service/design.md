## Context

See `proposal.md` — Why. This service is the one place where every other service's output is
combined into a number a person acts on, so it inherits every correctness rule established
upstream and is where a violation of any of them becomes visible.

The rules it depends on, all already specified elsewhere: `products-service` resolves costs
*as of a date* and returns a partitioned result separating priced from unpriced SKUs;
`supply-service` stores removals already split per reason, each flagged loss or not-loss, and
publishes a period-data-updated event carrying identifiers only; `sales-service` and
`inventory-service` supply quantities and distinguish "no data" from zero.

## Goals / Non-Goals

**Goals:**

- Reproduce, correctly, the four figures the operators compute by hand today.
- Make a reconciliation's trustworthiness explicit rather than implied.
- Recompute automatically when inputs change, so figures are never stale.

**Non-Goals:**

- No general ledger, accounts payable/receivable, tax, or forecasting. The spreadsheet this
  replaces is a reconciliation, not bookkeeping — and the generic ledger the admin panel
  currently mocks is the wrong model, replaced rather than extended.
- No manual adjustment of computed figures. A wrong figure is fixed by correcting its inputs,
  which keeps the computation reproducible.
- No per-store cost overrides — cost is network-wide, per `products-service`.

## Decisions

### D1 — The valuation date is the last day of the month being reconciled

Costs for March are resolved as of 31 March.

*Why:* `products-service` deliberately refuses to answer "the current cost" and requires a
date; something has to choose it, and leaving each caller to decide is how two screens end up
disagreeing. Month-end is chosen over month-start because a cost that takes effect mid-month
applies to most of that month's activity.

*Cost:* a cost effective mid-March values all of March, including movements before it took
effect. Accepted deliberately: the input data is monthly, so there is no within-month
resolution to be more precise with. The spec requires the chosen date to be *stated on the
output*, which makes the approximation visible rather than hidden.

*This is the decision most likely to be wrong for the business.* It is cheap to change and
must be confirmed with the operators against a month they have already reconciled by hand.

### D2 — Results are computed, stored, and served from storage

A reconciliation is materialised when its inputs change, not recomputed per request.

*Why:* computing on read means every dashboard load fans out to four services and multiplies
thousands of rows, and — worse — a historical month's displayed value would depend on what
`products-service` happens to return at that moment. Materialising makes a past month a fact
that was computed once, with the valuation date recorded alongside it.

*Consequence:* correctness now depends on recomputation actually firing, which is why the
event contract and the idempotency requirement matter more here than anywhere else.

### D3 — Unpriced SKUs make the reconciliation incomplete; they never contribute zero

*Why:* this is the failure the whole design guards against. A missing cost treated as zero
understates COGS and understates loss — it makes the numbers look *better*, so nobody
questions them. `products-service` returns a partitioned result specifically so that
`map[sku] ?? 0` is not the path of least resistance here.

*Consequence:* incompleteness propagates to rollups (spec requirement), because a network
total containing one unpriced store is not a total anyone should act on.

### D4 — Loss is valued from `supply-service`'s classification, never re-derived

This service asks for removal quantities with their loss flag and sums the flagged ones. It
does not carry its own list of which reasons count.

*Why:* two copies of the rule will diverge, and the copy in the reporting service is the one
people will trust. One home for the rule, in the service that owns removals.

### D5 — Exact decimal arithmetic, integers throughout

Money stays in integer minor units, matching `products-service`'s contract, and quantity ×
cost is integer multiplication.

*Why:* these figures are reconciled by hand against a spreadsheet. A drift of a few centavos
across thousands of rows is small, real, and would take days to explain — and would undermine
trust in the whole platform at exactly the moment it is being adopted.

*Consequence:* rounding happens only at presentation. Any intermediate division (percentages,
averages) must state its rule, which is why the spec requires it.

### D6 — Recomputation is triggered by the event, with a manual recompute available

*Why:* the event covers the normal path. A manual trigger exists because backfills, cost
corrections in `products-service`, and bug fixes all change figures without any supply data
changing — and `supply-service` deliberately publishes nothing in those cases.

*Note:* a cost correction should ideally recompute affected months automatically. That would
require `products-service` to publish its own event, which its change does not specify. Left
as a manual recompute for now and flagged in Open Questions rather than quietly adding a
cross-service contract that another change owns.

### D7 — Recomputation must be idempotent and scoped

Delivery is at-least-once, so the same store-month will be recomputed more than once.

*Why:* the spec requires stable repeated results. Implemented as a full replacement of that
store-month's stored figures within one transaction, mirroring the pattern `sales-service` and
`supply-service` already use — three services solving the same problem the same way is worth
more than three local optimisations.

## Risks / Trade-offs

- **A wrong valuation date silently changes every figure** (D1) → Mitigation: the date is
  recorded on the output and asserted in tests; validate against a month the operators have
  already reconciled by hand *before* the platform is trusted for a real close.
- **Materialised figures can go stale if an event is missed** (D2) → a silently stale number
  is worse than a slow one. Mitigation: record the inputs' last-changed marker alongside the
  computed result so staleness is detectable, and keep the manual recompute available.
- **This service depends on four others** → the most failure-prone read path in the platform.
  Mitigation: it serves stored results, so a downstream outage degrades *recomputation*, not
  reading. That is the main practical benefit of D2.
- **Incomplete reconciliations may be common at first** (unmatched SKUs are expected early) →
  if incompleteness is visually loud but ubiquitous, people learn to ignore it. Mitigation:
  the unmatched report is the operators' work queue via `products-service`'s override table;
  the panel should show how much value is affected, not just that something is.
- **Rollups across stores with different completeness** → Mitigation: the spec requires
  incompleteness to propagate; the alternative (silently summing what resolved) is the same
  class of bug as D3.

## Migration Plan

New service, no data migration. Historical months are populated by uploading past files
through `add-ingestion-flow` and letting recomputation run — the same path as a normal month,
which is why the idempotency contract matters.

The acceptance bar for this change is not "tests pass": it is that a month reconciled by this
service matches the operators' own spreadsheet for a month they have already closed by hand.

## Open Questions

- Whether a cost correction in `products-service` should automatically recompute affected
  months, which needs that service to publish an event it does not currently specify.
  Deferrable: the manual recompute covers it, and adding the contract is its own change.
- Whether the business wants loss expressed as a percentage of restocked value or of revenue.
  Deferrable: it is a derived presentation figure and changes no stored data.
