# Retail KPIs

Compute only what the available data supports; label anything derived from
an assumption. All formulas here are also implemented in
`scripts/retail_finance.py` where the calculation is non-trivial enough to
be worth a tested function.

## Revenue

- **Gross Revenue** — total sales before discounts/returns.
- **Net Revenue** = Gross Revenue − Discounts − Returns.
- **Revenue Growth** = (Period N − Period N-1) / Period N-1.
- **Same Store Sales Growth** — revenue growth restricted to stores open in
  both periods; never blend in newly opened stores or the growth number
  overstates organic performance.
- **Revenue per Store**, **Revenue per m²** (needs store area as a fact).
- **Average Ticket** = Net Revenue / Transactions.
- **Transactions per Day**.
- **Revenue per Transaction** — same as Average Ticket; use one term
  consistently in a given output.

## Margin

- **Gross Margin %** = Gross Profit / Net Revenue.
- **Contribution Margin %** = Store Contribution / Net Revenue — see
  [store-unit-economics.md](store-unit-economics.md).
- **Operating Margin %** = Fully Allocated Store Profit / Net Revenue.
- **EBITDA Margin** — only where a company-level EBITDA is meaningful
  (multi-store rollup with real corporate P&L); state explicitly if
  approximated from Fully Allocated Store Profit rollup.
- Break out margin by store, category, SKU, and supplier — a network-average
  margin hides which of these is actually dragging it down.

## Inventory

See [inventory-finance.md](inventory-finance.md) for GMROI, turnover, DIO,
sell-through, dead stock, and aging in depth.

- **Stockout Rate** = periods/SKUs with zero available stock during demand /
  total demand periods.
- **Shrinkage Rate** = Perda real (shrinkage+theft classified) / Net
  Revenue, and separately / total inventory movement (cost basis) — report
  both, they answer different questions (see "Losses" below).
- **Expiration/Waste Rate** — same two denominators.

## Working Capital

See [working-capital.md](working-capital.md).

## Store Investment

- **CAPEX per Store**.
- **Payback Period** = Initial Investment / Monthly Contribution (simple) or
  the period where cumulative contribution first exceeds investment
  (preferred when contribution ramps rather than starting flat).
- **ROI** = (Total Return − Investment) / Investment, over a stated period.
- **ROIC** = NOPAT / Invested Capital (CAPEX + working capital tied up) —
  the right metric for comparing a new store against alternative uses of the
  same capital.
- **Break-even Revenue / Break-even Transactions** — see
  [store-unit-economics.md](store-unit-economics.md).
- **Cash-on-Cash Return** = Annual pre-financing cash flow / Cash invested.
- **Incremental Contribution / Incremental Free Cash Flow** — for
  expand-vs-improve-existing comparisons, use the *incremental* number, not
  the store's total contribution, when capital is fungible across options.

## Losses — always both denominators

Report loss (shrinkage, expiration/waste, damage, adjustments) as:

- **% of revenue** — the P&L-facing view.
- **% of inventory movement (cost basis)** — the operations-facing view,
  comparable across stores with very different price points.

A store with high revenue and average shrinkage-% of revenue can still have
an alarming shrinkage-% of cost if its assortment skews toward cheap,
high-volume, easily-lost items — check both before concluding a store is
"fine."
