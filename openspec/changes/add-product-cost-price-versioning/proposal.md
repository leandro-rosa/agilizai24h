## Why

Cost and price are already dated series, but a version has no origin, no user, no supplier and no invoice, and recording the same date again **overwrites** the earlier value without a trace. Purchases and invoices do not feed cost. Pricing, DRE, CMV and margin cannot answer "what was the cost on the day it sold, and who said so?" until history is append-only and traceable.

## What Changes

- **Append-only versions.** A new cost or price for a date that already has one adds a corrective version; nothing is overwritten. The value in force on a date is the latest effective date up to it and, among versions of that date, the latest recorded. Consumers of the as-of lookup do not change.
- **Provenance on every version:** source (`manual`, `invoice`, `pricing_intelligence`, `catalogue_sync`, `legacy_import`, `other`), user, reason, and for cost the supplier, purchase and original purchase quantity and total. Existing rows become `legacy_import` with no invented user or supplier.
- **Invoice-originated cost.** A received purchase creates a cost version automatically, effective on the **receipt date**, with an alert for a large variation or a closed month. A bonus item never creates a cost. On a conflict the later effective date wins and, on the same date, the invoice wins; the manual version stays visible as superseded.
- **Purchases keep the original of the packaging** (pack quantity, pack price, units per pack, purchase unit) and the invoice issue date.
- **Several EANs per product.** A new table links products and EANs (status, validity, origin, note, principal). An EAN is never deleted and never active on two products; an invoice with an old or a new EAN resolves to the same SKU, and an unknown EAN is reported, never turned into a product.
- **Product record:** edit subcategory, status and sale unit. The internal code is the SKU.
- **Gateway** exposes the price routes the admin already calls and does not find, and writes manual cost/price with the session user and a required reason.
- **Admin `/products`** evolves into the product registry with a drawer: Visão geral, Custos, Preços, Histórico, Compras, Margem.
- **Reused, not rebuilt:** the CMV of finance-service/DRE (end-of-month cost, unchanged) and the monthly margin of the existing product analysis.

Not in scope: Smart Supply, a new pricing screen, any change to how CMV is computed.

## Capabilities

### New Capabilities
- `product-eans`: several EANs per product, never deleted, never active on two products, resolved by active or historical EAN.
- `product-cost-history`: provenance, append-only same-date handling, invoice-originated cost and its effective date, conflict rule, bonus rule, timeline, honest history start, historical margin that never uses today's cost.

### Modified Capabilities
- `products`: "Dated cost versions" no longer replaces a version recorded for an existing date.

## Impact

- `backend/apps/products-service`: migration on `cost_version`, `price_version` and `product`; recording, as-of lookup, timeline and margin reads; catalogue-sync writes go through the same recording.
- `backend/apps/suppliers-service`: migration on `purchase` and `purchase_item`; `GET /purchases?sku=`; a queued cost sync on receipt.
- `backend/apps/gateway-service`: price routes, manual cost/price with the session user, timeline routes; the pricing apply flow passes origin and decision id.
- `frontend/apps/admin`: `/products` and the product drawer; deep link to a purchase.
- Contracts: `@app/products-contracts` bulk shapes unchanged.
- Closed months: a cost effective inside a closed month changes that month's CMV only if someone recomputes; the change warns and does not recompute.
