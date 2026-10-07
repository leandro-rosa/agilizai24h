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
6. **Suppliers → products by queue.** On receipt the purchase enqueues one job (idempotent key = purchase item id stored as `source_ref`); the worker calls products-service; failure is stored on the item (`cost_sync_error`) and retryable.
7. **CMV untouched.** The monthly margin tab reuses the product analysis (end-of-month cost). A cost that changes inside a month is marked, not hidden.
8. **No new product registry and no new CMV.** Internal code is the SKU; `sale_unit` is the only new product column.

## Risks / Trade-offs

- [Relaxing the unique key touches every reader] → contract unchanged and covered by tests before the migration.
- [A late invoice changes a closed month's CMV if recomputed] → flagged, never auto-recomputed.
- [Two services in one flow] → queue with idempotent key and visible failure.
- [Legacy rows have no origin] → `legacy_import`, never invented.

## Migration Plan

Additive columns, then the index change; backfill `source = legacy_import` for existing rows (counts before and after must match: 255 costs, 23 prices at the time of writing). Rollback: the columns are nullable and the old unique can be restored only if no same-date duplicates exist.

## Open Questions

- The limit for a "large variation" flag (proposed 10%, to be reviewed on real data).
