## Why

"Compras e Fornecedores" shows what was restocked, sold and lost, but purchases do not exist: every purchase figure reads "Sem histórico de compras", and the owner cannot answer what was bought, what is owed and to whom. Suppliers also deal on different terms. Some sell outright, some give goods as a bonus (bonificação), and some, like Quinoa, send quantities that the owner tests and pays for only after a weekly sales survey, only for what sold and did not expire. None of that can be recorded today, and a bonus item at cost R$ 0,00 (e.g. "Sprite zero") reports a misleading 100% margin.

## What Changes

- New purchase model: **order**, **invoice** (nota fiscal) and **item**, per supplier and SKU, with quantity, unit cost paid and date. Purchase history starts in October/2026; earlier months keep "Sem histórico de compras".
- Two ways in: **invoice import** (NF-e XML) and **manual entry** for suppliers that issue no invoice.
- Each item carries a **condition**: `paid` (bought outright), `bonus` (bonificação, no cost) or `on_sale` (consignado: owed only for what sells).
- **Weekly settlement** (acerto): for `on_sale` items, amount owed = units sold in the week × agreed unit cost; units unsold, expired or returned are not owed. The owner reviews and confirms a settlement; payment status is recorded (pending / paid). Nothing is paid or posted by the system.
- The analysis `PurchaseSource` is wired to the real purchases: bought units/value, orders, invoices, bought-versus-restocked and the purchase insights come alive.
- Bonus items are **excluded from margin and markup** (flagged instead of reading 100%), and surfaced as their own figure.
- Admin gets "Pedidos" and "Notas fiscais" pages under "Compras", and the header actions "Importar nota fiscal" and "Lançar compra".

## Capabilities

### New Capabilities
- `purchasing`: orders, invoices and items per supplier and SKU; invoice import and manual entry; purchase history from Oct/2026.
- `purchase-settlement`: item conditions (paid, bonus, on-sale) and the weekly settlement of on-sale items with payment status.

### Modified Capabilities
- `supplier-product-analysis`: purchase figures and insights are filled from real purchases; bonus items leave margin and markup.
- `web-admin`: Pedidos and Notas fiscais pages, invoice import and manual-purchase actions, settlement screen.
- `ingestion`: a purchase-invoice file type (NF-e XML).

## Impact

- `backend/apps/suppliers-service`: new tables (purchase, purchase item, settlement) and routes; chosen over a new service (see design.md).
- `backend/apps/ingestion-worker-service`: NF-e XML parser and file type; `gateway-service` routes and permissions.
- `backend/apps/intelligence-service`: real `PurchaseSource`; bonus excluded from margin.
- `frontend/apps/admin`: new pages and actions; table and KPI changes.
- Data: purchases are new records; no existing table is rewritten. Cost versions in products-service are not changed by purchases (a purchase cost is a paid fact, the registered cost is a reference).
