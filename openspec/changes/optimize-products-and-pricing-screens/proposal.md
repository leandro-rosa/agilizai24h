## Why

Products and Smart Pricing look like two catalogues that disagree: Products shows costs and no prices, Pricing shows prices and many products "without reliable cost". Investigated on the dev stack (read-only): there is ONE registry (products-service: 255 products, 255 cost versions, 23 price versions). The disagreement has two causes. (1) The running gateway is an old build without the price routes, so Products' price column is always empty (`POST /products/prices/bulk` answers 404 there). (2) 232 of the 255 costs are the 2026-01-01 initial load, never updated and with no purchase in the analysed window, so the engine calls them stale; the same 232 products also have no price. Neither is a second catalogue, so the fix is to make the single registry obvious, remove what each screen duplicates, and say plainly why a product is not analysable.

## What Changes

- **Products screen** becomes catalogue maintenance: a slim table (SKU, name, category, principal EAN with a marker for more, sale unit, last unit cost with its date, status, open), actions New product / Import Excel / Export catalogue. Price and margin leave the table (analysis lives in Pricing). Search still finds any EAN, filters are category and status.
- **Product detail** edits identification, category, brand and packaging; defines purchase unit, sale unit and the box-to-unit factor; lists several EANs; shows the cost history; links to the product's pricing.
- **One creation flow**: manual, Excel and "from an invoice line" all go through the same registration form and the same service; the origin is recorded (manual, invoice, excel).
- **Excel import** with a downloadable template, column mapping, a preview (new / updates / conflicts) and no silent erasure by empty cells.
- **Pricing screen** keeps analysis, simulation and approval: three cards plus the coverage of the analysis, a compact clickable list of products without a reliable cost (with the reason and the way to fix it), a leaner table, "Mais filtros", one "Exportar" button, a collapsible data-quality summary, engine/rules versions moved to the calculation details, and an "Editar cadastro" link into Products.
- **Clarity of the calculation**: the detail explains the cost method and origin, taxes and fees, the kind of margin, the target and the premises of the estimated impact; a period is a historical analysis, and a newer cost than the period is flagged instead of appearing as that period's cost.
- **Integration**: the "Sincronizar com a precificação" button goes (its spreadsheet import moves under Import Excel); a confirmed cost or product marks the stored pricing report as needing recalculation; the approved price stays until approval; nothing claims a price was published to the POS or card machine.

## Capabilities

### New Capabilities
- `product-catalogue-screen`: the slim Products table, the actions and the product detail.
- `catalogue-import`: Excel template, mapping, preview and apply with conflict handling.
- `pricing-screen-focus`: the reduced Pricing screen, coverage, pending list and calculation explanations.

### Modified Capabilities
<!-- The pricing-screen and product registry capabilities live in other changes that are not archived yet; this change builds on them. -->

## Impact

- `frontend/apps/admin`: `/products` page and components, a new import wizard, the pricing components, the sidebar.
- `backend/apps/products-service`: `brand` and `purchase_unit` on the product; an import preview/apply; `origin` accepts `excel`.
- `backend/apps/intelligence-service`: coverage and pending reasons in the report, a flag for a cost newer than the period, a "data changed since the run" read.
- `backend/apps/gateway-service`: import routes.
- Deploying: the dev containers must be rebuilt (the running gateway lacks the price routes and the dev databases lack the new migrations).
