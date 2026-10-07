## Context

The approved analysis and architecture are in the plan `tela-de-precifica-o-inteligente-reflective-prism.md` (sections A–K). Current state that matters: `cost_version` / `price_version` are unique by `(product_id, effective_from)` and recorded by upsert; finance values CMV at the end-of-month cost; suppliers-service never writes cost; the gateway exposes no price route.

## Goals / Non-Goals

**Goals:** append-only, traceable versions; invoice-originated cost; one place for the vigência rules (backend); history readable per product.
**Non-Goals:** changing the CMV method, recomputing closed months, automatic price changes, Smart Supply, a new pricing screen.

## Decisions

1. **Append-only by relaxing the unique key.** The `(product_id, effective_from)` unique becomes a non-unique index; lookup uses `effective_from <= as_of` ordered by `effective_from desc, id desc`. The as-of contract and `@app/products-contracts` do not change. Alternative: a separate audit table (rejected: two sources of truth).
2. **Same-date precedence is a stored rank, not a read-time guess.** Each version stores `source`; resolution among same-date versions is invoice over manual over the rest, then latest recorded. A superseded version is derived (not the one in force), not stored.
3. **Validity end is derived** from the next version. Margin is never stored.
4. **Vigência from an invoice is the receipt date**, the rule purchases already use; issue date and processing time are kept. Owner decision 2026-10-07.
5. **Automatic creation on receipt**, for any difference in unit cost (no tolerance until real data is seen), never for bonus, with flags for large variation and closed month. Owner decision 2026-10-07.
6. **Suppliers → products by an outbox in the purchase item, not BullMQ.** The receipt commits and marks each non-bonus item `cost_sync = pending` in the SAME transaction (a bonus is `skipped_bonus`, never sent). A loop inside suppliers-service (`COST_SYNC_INTERVAL_MS`, 30 s) plus an immediate drain after the receipt calls products-service `POST /products/:sku/costs` (`source: invoice`, vigência = `received_on`, `source_ref = purchase-item:<id>:<day>:<cost>`). The key makes a resend a no-op, so retry is safe; it carries the cost and the day so a corrected item creates the corrected version instead of being swallowed. Failure is stored on the item (`failed`, `cost_sync_error`, attempts) and retried with backoff (1, 2, 4… up to 30 min, 8 attempts) or by `POST /purchases/:id/cost-sync`. BullMQ was rejected for this service: it has no queue today, so it would add Redis, `hold-it` and the Kafka DI hazard for a few items per week; the outbox is durable in the database that already holds the fact. Existing purchases keep `cost_sync = NULL`: nothing is sent retroactively without a decision. The response of products-service says `unchanged` when the cost in force already equals the invoice cost (no version is written) and the cost it replaced; suppliers computes the variation (flag at `COST_VARIATION_ALERT_BPS`, default 1000 = 10%, provisional) and asks accounting whether the month is closed (`closed_month`; unreachable or not configured is `closed_month_unknown`, never "open"). A closed month is flagged only: finance does not recompute by itself.
7. **CMV untouched.** The monthly margin tab reuses the product analysis (end-of-month cost). A cost that changes inside a month is marked, not hidden.
8. **No new product registry and no new CMV.** Internal code is the SKU; `sale_unit` is the only new product column.

9. **A new product's first cost is created at receipt (owner decision 2026-10-07).** Same effective-date rule as every invoice cost. Until then the suggestion uses the invoice cost, labelled. Alternative: create it at once on the invoice date (rejected: it would break the receipt-date rule).
10. **SKU suggestion is a premise, not a rule.** products-service has no SKU generation; the real catalogue is all numeric and the newest block is six digits (100011–110023). The next number after the highest six-digit SKU is suggested and confirmed by the user, never created alone, and a duplicate is refused.
11. **Pending lines are kept on the purchase, not in a second registry.** A line whose product is not registered stays as a pending line of the purchase (description, EAN, quantity, cost); registering it, linking an EAN or choosing a product turns it into a purchase item. No product or SKU exists for it meanwhile.
12. **The suggestion is the existing engine.** For a product with no price or sales it computes the three prices from the invoice cost, the category and the versioned parameters, flags it as new, lowers the confidence and lists what it used. No second formula.

## Risks / Trade-offs

- [Relaxing the unique key touches every reader] → contract unchanged and covered by tests before the migration.
- [A late invoice changes a closed month's CMV if recomputed] → flagged, never auto-recomputed.
- [Two services in one flow] → queue with idempotent key and visible failure.
- [Legacy rows have no origin] → `legacy_import`, never invented.

## Migration Plan

Additive columns, then the index change; backfill `source = legacy_import` for existing rows (counts before and after must match: 255 costs, 23 prices at the time of writing). Rollback: the columns are nullable and the old unique can be restored only if no same-date duplicates exist.

## Open Questions

- The limit for a "large variation" flag (proposed 10%, to be reviewed on real data).
