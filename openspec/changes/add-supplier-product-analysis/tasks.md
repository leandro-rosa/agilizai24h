## 1. Backend foundations

- [x] 1.1 Define the response contract (tri-state figures, insight shape, 6-month series, comparison modes, data-quality flags) as shared types
- [x] 1.2 Add `PurchaseSource` port and null implementation returning `no_purchase_history`
- [x] 1.3 Check products-service product update accepts `supplier_id`; extend it (with test) if not
- [x] 1.4 Add situation / loss-vs-network parameters (provisional defaults, validation, docs) to the parameter store

## 2. Aggregation

- [x] 2.1 Fetch restock, sales, loss and cost per store × month for the requested window, treating "never ingested" as missing, not zero
- [x] 2.2 Implement supplier analysis (rows, totals, previous-month and 3-month-average comparison)
- [x] 2.3 Implement product analysis with per-store table and situation
- [x] 2.4 Implement cross view (supplier × product) and multi-supplier comparison gated on purchase data
- [x] 2.5 Implement 6-month evolution with "no purchase history" months
- [x] 2.6 Flag incomplete months/stores (sales coverage) and mark affected figures partial
- [x] 2.7 Unit tests for each of the above, including zero-vs-missing cases

## 3. Insights

- [x] 3.1 Implement insight rules with evidence and labels; suppress purchase-dependent ones when unavailable
- [x] 3.2 Tests: evidence numerators/denominators, estimate labelling, parameter version recorded
- [x] 3.3 Calibration script: real sold/restocked distribution per store × SKU stratified by turnover; present to owner before fixing cut-offs

## 4. Gateway

- [x] 4.1 Expose `GET /analysis/suppliers/:id`, `/products/:sku`, `/cross` through gateway-service with `supply:read`
- [x] 4.2 Gateway/e2e tests for permission and error mapping

## 5. Admin frontend

- [x] 5.1 RTK Query slice `src/lib/api/supplier-analysis.ts`
- [x] 5.2 Sidebar group "Compras" and route `/purchases` (no Pedidos / Notas fiscais entries)
- [x] 5.3 Header, period selector with previous-month, filters, comparison toggle, mode tabs
- [x] 5.4 Supplier view: identity card, 6 KPI cards with comparison, movement bars, product table
- [x] 5.5 Product view: supplier block, movement, comparison, per-store table with `StatusBadge`
- [x] 5.6 Cross comparison table and 6-month evolution chart/table
- [x] 5.7 Insights list with expandable evidence; "Sem histórico de compras" / "—" / "Indisponível" states
- [x] 5.8 Link-supplier dialog for products without supplier
- [x] 5.9 Component and helper specs; `pnpm turbo run lint typecheck` and `pnpm test`
- [x] 5.10 Update `frontend/apps/admin/CLAUDE.md` and DESIGN.md notes

## 6. Verification

- [x] 6.1 Bring up the stack and check the page against real data in the browser; cross-check one product against /supply Perdas
- [x] 6.2 Confirm no synthetic data reached real databases
- [x] 6.3 Commit, merge and push in the same session

## 7. Supplier names from the pricing spreadsheet

- [x] 7.1 Pure review core: group sheet names, suggest without deciding, plan what would be written (with specs)
- [x] 7.2 Review card on the catalogue sync page: link, create, skip; confirmation dialog; alias on confirm; never overwrite an existing supplier
- [ ] 7.3 Operator runs the review on the real spreadsheet (writes to real data, needs the owner)
