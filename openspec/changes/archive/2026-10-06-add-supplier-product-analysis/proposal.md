## Why

The owner cannot answer "how much did I buy, restock, sell and lose of this supplier's / product's items, and in which stores does it actually sell?". Restocked, sold, lost, revenue and cost already exist per store × month × SKU, but are only visible store-by-store or SKU-by-SKU. Purchases (invoices, orders, items) do not exist anywhere: the only supplier money trail is aggregated cash in `treasury-service`, with no SKU or quantity. We need the analysis screen now, built so purchase data can plug in later without changing the contract.

## What Changes

- New admin page "Compras e Fornecedores" (new sidebar group "Compras"), with modes **Por fornecedor** and **Por produto**, a supplier × product cross filter, a 6-month evolution and contextual insights that always show their evidence.
- New backend analysis endpoints in `intelligence-service` that aggregate restock, sales, loss, cost and supplier link per supplier / product / month, compared with the previous month or the 3-month average.
- Purchase-dependent figures (bought quantity/value, orders, invoices, bought-vs-restocked) are returned as unavailable with reason `no_purchase_history` until a purchase source exists; the UI shows "Sem histórico de compras", never zero. Purchase history is expected from Oct/2026 only.
- Store situation (Bom / Atenção / Crítico) and "loss above network average" rules become versioned, provisional parameters in the existing parameter store, calibrated against real distributions before being treated as definitive.
- A dialog to link a product to its supplier from the screen (writes `supplier_id` on the product); only declared links are used, never inferred.
- Header buttons "Importar nota fiscal" / "Lançar compra" and menu items Pedidos / Notas fiscais are **not** part of this change (Phase 2: purchase model, invoice ingestion and manual entry for suppliers without invoices).

## Capabilities

### New Capabilities
- `supplier-product-analysis`: backend aggregation, insights with evidence, store situation and honest absence of purchase data for supplier / product / cross / 6-month views.

### Modified Capabilities
- `web-admin`: new "Compras e Fornecedores" page, "Compras" navigation group, supplier-link dialog.
- `intelligence-parameters`: new provisional parameters for store situation and loss-versus-network comparison.

## Impact

- `backend/apps/intelligence-service`: new module `supplier-product-analysis`; new parameter defaults and validation.
- `backend/apps/gateway-service`: new routes; permission `supply:read`.
- `backend/apps/products-service`: confirm / extend product update to set `supplier_id`.
- `frontend/apps/admin`: new route `/purchases`, sidebar group, components under `src/components/supplier-analysis/`, RTK Query slice, `CLAUDE.md` update.
- No new database tables in this change. Known data limits inherited: sales for Aug/2026 incomplete in 7 stores, Aug/Sep without receipts; restock and loss are monthly only.
