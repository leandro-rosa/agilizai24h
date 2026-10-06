## Context

Phase 1 (`add-supplier-product-analysis`, archived) made the analysis read purchases through a `PurchaseSource` port with a null implementation, and every purchase figure is "unavailable (`no_purchase_history`)". Supplier links live in `Product.supplier_id`; suppliers and aliases in suppliers-service; sold quantities per store/SKU/month in sales-service; expired and returned removals per reason in supply-service. Billing's `Invoice` is outgoing (clients) and unrelated. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Purchases as facts (order, invoice, item) with a condition per item, and a weekly settlement for on-sale items.
- Fill the existing `PurchaseSource` without changing the analysis contract.
- Bonus never distorts margin.

**Non-Goals:**
- Making or posting payments, bank reconciliation, or accounting entries (a human does that outside; the system records status only).
- Changing registered cost versions from purchases.
- Purchase planning or suggested orders.
- Per-store purchase attribution (purchases are bought for the network; the analysis already shows them as "—" under a store filter).

## Decisions

1. **Home: suppliers-service, not a new service.** It owns suppliers, aliases and categories, and purchases are about suppliers. A 16th service for three tables adds a database, a Dockerfile and a gateway domain for little. Alternative: `purchasing-service` — reconsider if purchasing grows (planning, returns).
2. **Tables**: `purchase` (supplier, ordered_on, origin `manual|nfe`, invoice_number nullable, invoice file reference nullable, status), `purchase_item` (purchase, product sku/id, quantity, unit_cost_cents, condition `paid|bonus|on_sale`, payment status), `settlement` (supplier, week start, state `proposal|confirmed|paid`, totals, evidence JSON, confirmed/paid dates). Money is integer cents; quantities integer units.
3. **Condition on the item**, not the supplier: the same supplier can send some products on sale and some outright (the owner's Quinoa example). A supplier-level default is a convenience in the form, not the rule.
4. **Settlement is computed, then confirmed.** Units sold in the ISO week come from sales-service (dated receipts when they exist; otherwise the week is marked partial, since monthly totals cannot be cut by day), expired and returned are reported by the operator at settlement (supply removals exist only per month, so a week cannot be cut from them), delivered from the items. Owed = sold × unit cost over delivered quantity not already settled. It is stored as a `proposal` with its evidence and becomes `confirmed` only by an operator. Alternatives: pay on monthly totals (rejected: the owner settles weekly); auto-confirm (rejected: money decision needs a human, as with every consequential action here).
5. **Invoice parsing is a stateless call, not a queue job.** One NF-e is a small XML: the ingestion service parses it synchronously and returns the resolved and unresolved lines; nothing is recorded until the operator confirms in the screen, which then creates the purchase. The raw file goes to object storage first, like every upload. Alternative: a BullMQ job per file (rejected: nothing to wait for, and the review step needs the result immediately).
6. **Idempotent NF-e import.** Unique on issuer tax id + invoice number; items resolved by EAN then by SKU/alias, never fuzzy (same rule as name matching in products-service); unresolved items are held for review, not stored.
7. **`PurchaseSource` real adapter** reads purchases by SKU and month (whole-month figures; day slices still show none, as designed). `bonus` units are returned separately; margin/markup/profit/attention computation skips bonus-only products and flags the reason `bonus`.
8. **Purchase history base**: the first purchase month is derived from the data (`baseFrom`), so earlier months stay "no purchase history" with no hard-coded date.

## Risks / Trade-offs

- [Weekly sales need dated receipts, which exist only for Aug/Sep/2026 and now onward] → for any week without them the settlement is marked partial and cannot be confirmed until the owner accepts it explicitly; future months are covered because the receipt date is now read.
- [On-sale delivered units can span weeks, so "owed" is cumulative] → settle by item with a running balance (delivered − sold − expired − returned = still open), shown in the evidence.
- [NF-e variety (CFOP, units, packaging)] → import only the fields needed; packaging conversion (box of 24) uses `units_per_package` when present and otherwise asks.
- [A bonus later billed] → condition is changeable until settled, with the change recorded.

## Migration Plan

Additive tables in suppliers-service (Prisma migration runs on startup); no existing data changes. Rollback: stop reading `PurchaseSource` (swap back to the null adapter); tables stay.

## Open Questions

- Whether consignment returns of unsold goods are physically returned or kept for another week (affects only the evidence labels).
- Which suppliers issue NF-e today (to prioritise the import over manual entry).
