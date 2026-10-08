## 1. Backend
- [x] 1.1 `sku_sequence`, `SkuSequenceService`, optional `sku` on create, spreadsheet rows without SKU, counter moved by explicit SKUs, forecast route
- [x] 1.2 `net_weight` on create and update
- [x] 1.3 `PricingQuery.asOf`, `GET /pricing/current`, simulation and stores on the current basis, decisions with `basis: "current"`, `blocker` on the suggestion
- [x] 1.4 Gateway routes and pass-through

## 2. Frontend
- [x] 2.1 Unified list, quick filters, pendencies, selection and batch review
- [x] 2.2 "Revisar preço" panel with live margin, scope and effective date confirmation
- [x] 2.3 New product panel (manual; AI input disabled with the real reason), box/bundle conversion, automatic SKU
- [x] 2.4 Suggestion states, stale-answer discard, retry
- [x] 2.5 Categories page, "Analisar período", old links kept

## 3. Verification
- [x] 3.1 Unit and component tests; integration tests on a throwaway Postgres (real SQL for the SKU sequence)
- [x] 3.2 Throwaway stack: real engine, simultaneous SKUs over HTTP, price applied and recorded, failure and recovery with the pricing service stopped, batch save
- [x] 3.3 Screenshots at 1366x768: list, new product, price panel, pendencies, categories, batch
- [ ] 3.4 Owner decisions: per-store prices (data model), AI fill-in integration, product variants
