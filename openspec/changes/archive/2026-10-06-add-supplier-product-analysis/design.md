## Context

Restock (`RestockRecord`), loss (`RemovalRecord`/`AdjustmentRecord`), sales (`SalesRecord`) and cost (`CostVersion`) live in separate services, per store × month × SKU. Supplier link is `Product.supplier_id` (optional, sparse). There is no range or network endpoint: the admin fans out one request per store and month client-side. Parameters and evidence already live in `intelligence-service` (`modules/parameters`, `runs/network-evidence.ts`). See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- One backend contract per view (supplier, product, cross) including the 6-month series, comparison and insights.
- Purchase data pluggable later behind a stable contract.

**Non-Goals:**
- Purchase/invoice/order models, NF-e import, manual purchase entry (Phase 2).
- Inferring supplier by name, EAN or cost.
- Daily granularity (restock and loss are monthly).

## Decisions

1. **Aggregation in `intelligence-service`, not in the browser.** Rules that shape recommendations must live in the backend and be parameterised; it also avoids N stores × 6 months × 3 sources fan-out from the client. Alternative: reuse the client fan-out (as `/supply`) — rejected for the rules requirement and request volume.
2. **`PurchaseSource` port with a null implementation.** Returns "unavailable (`no_purchase_history`)". Phase 2 supplies a real adapter. Alternative: build the purchase model now — rejected, user chose screen-first.
3. **Tri-state figures** (`value | unavailable(reason) | partial(value, coverage)`) in the contract so the UI can never render a missing figure as 0.
4. **Insights as data**: `{ kind, label (FATO|MÉTRICA DERIVADA|ESTIMATIVA), text, evidence: { figures, numerator, denominator, reference }, parameterVersion }`. Frontend only renders.
5. **Situation parameters** added to the existing versioned parameter set; defaults provisional. Calibration step: print the real distribution of sold/restocked per store × SKU stratified by turnover before proposing cut-offs (owner reviews, as with the balance tolerance).
6. **Supplier link write** goes through products-service's existing update path (extend only if it does not accept `supplier_id`); the page invalidates the product cache.
7. **Frontend**: `/purchases` page, `Tabs` for modes, pure helpers for formatting only, recharts via `ChartContainer`; layout follows the owner's mockup (dark theme, tokens from DESIGN.md, not mockup hex).

## Risks / Trade-offs

- [Coverage gaps: Aug/2026 sales incomplete in 7 stores, Aug/Sep without receipts] → response carries partial flags; UI marks figures partial.
- [Sparse supplier links make "by supplier" nearly empty at first] → "sem fornecedor cadastrado" list plus link dialog; no inference.
- [Cross-service aggregation latency] → per-month calls in parallel, cache by (period, parameter version); measure before optimising.
- [Provisional thresholds read as truth] → labelled provisional in UI and response.
- [Multi-supplier per product has no model] → cross comparison only meaningful after Phase 2; stated in UI.

## Open Questions

- Which service owns purchases in Phase 2 (suppliers-service is the working assumption).
- Whether `products-service` update already accepts `supplier_id` (checked in task 1.3).
