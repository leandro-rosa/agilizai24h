## 1. Versions in products-service (append-only, provenance)

- [x] 1.1 Migration: provenance columns on `cost_version` and `price_version`, relax the unique key to an index, backfill existing rows as `legacy_import`
- [x] 1.2 Record cost and price as new versions (never upsert), with source, user, reason and the purchase fields; catalogue-sync writes through the same recording with source `catalogue_sync`
- [x] 1.3 As-of lookup: latest effective date, then source precedence for the same date, then latest recorded; contract unchanged
- [x] 1.4 Version lists return derived `valid_to`, `superseded` and the provenance
- [x] 1.5 Tests: same-date correction, invoice over manual, later manual over earlier invoice, before the first version, bulk contract unchanged, past margin unchanged
- [x] 1.6 Apply the migration in dev and compare counts before and after

## 1b. EANs per product (amendment 2026-10-07)

- [x] 1b.1 `product_ean` table (status, validity, source, note, principal), partial uniques (active EAN, one principal), backfill from `product.ean`, drop the unique single-EAN column
- [x] 1b.2 Add, retire, reactivate, set principal, edit note (never delete); EAN active on another product is refused naming it
- [x] 1b.3 Resolve an EAN: active first, historical when unique, ambiguous and unknown reported, never creating a product
- [x] 1b.4 `ProductView` carries `ean` (the principal) and `eans`; product creation and catalogue sync go through the new links
- [x] 1b.5 NF import in suppliers matches active and historical EANs (`ean_historical`) and reports "EAN não identificado"
- [x] 1b.6 Tests: one EAN, a second, retire the old, old and new EAN in two invoices to the same SKU, unknown EAN, ambiguous, active on two products refused, history unified by SKU
- [x] 1b.7 Migration verified on a throwaway copy of the real database

## 2. Gateway

- [x] 2.0 Gateway routes for the EAN actions with the session user
- [x] 2.1 Expose `prices/bulk`, `:id/prices`, `:sku/prices` (the routes the admin calls)
- [x] 2.2 Manual cost and price with the session user and a required reason
- [x] 2.3 `GET /products/:id/timeline` and `GET /products/:id/price-margins` in products-service, routed by the gateway
- [x] 2.4 Pricing apply passes source `pricing_intelligence`, the decision id, the user and the reason

## 3. Purchases keep the original

- [ ] 3.1 Migration and recording: invoice issue date; per item pack quantity, pack price, units per pack, purchase unit
- [ ] 3.2 `GET /purchases?sku=` with the original of the packaging

## 4. Invoice to cost

- [ ] 4.1 On receipt, enqueue the cost sync (idempotent key = purchase item id); never for bonus; only when the cost differs
- [ ] 4.2 Vigência = receipt date; flags for variation and closed month; failure stored and retryable
- [ ] 4.3 Tests: rise, same cost, bonus, repeated sync, closed month, failure

## 5. Admin `/products`

- [ ] 5.1 List with the filters and columns of the registry
- [ ] 5.2 Drawer: Visão geral (with the Identificação section: EANs table and + Adicionar EAN), Custos, Preços, Histórico
- [ ] 5.3 Dialogs for a new cost and a new price (value, start date, reason)

## 6. Purchases and margin tabs

- [ ] 6.1 Aba Compras and the deep link to the purchase
- [ ] 6.2 Aba Margem from the existing product analysis, labelled

## 7. Pricing

- [ ] 7.1 The pricing engine reads the real origin, last purchase cost and variation instead of the heuristic
