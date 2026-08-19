# Inventory as Capital

Inventory is invested capital, not a byproduct of revenue. A high-margin or
high-revenue SKU is not automatically financially attractive — if it turns
slowly, it's tying up cash that could sit in a faster-turning SKU or fund
another store. Never optimize revenue or gross margin without checking what
capital it consumed.

## Core metrics

- **Inventory Turnover** = COGS (period) / Average Inventory Cost (period).
- **Days Inventory Outstanding (DIO)** = 365 / Turnover (annualized) or
  period-days / Turnover (for a shorter window — be explicit which).
- **GMROI** = Gross Margin (R$) / Average Inventory Cost (R$). State
  explicitly whether "Gross Margin" here is the **monetary** gross profit
  or a **percentage** before quoting the number — the two produce very
  different-looking results and this is the single most common GMROI
  mistake. This skill's convention: GMROI uses monetary gross profit unless
  stated otherwise, because it's the version comparable in R$ terms across
  SKUs of different price points.
- **Sell-through** = Units sold / (Units sold + Units remaining), over a
  stated window.
- **Stockout Rate**, **Shrinkage Rate**, **Expiration/Waste Rate** — see
  [retail-kpis.md](retail-kpis.md).
- **Dead Stock / Slow-moving Inventory** — SKUs with turnover well below the
  category median, or zero sales over a stated window, flagged with the
  capital they're holding.
- **Inventory Aging** — time since last restock vs. time since last sale,
  by SKU.
- **Inventory Investment per Store** = Average Inventory Cost, by store.

Formulas with non-trivial arithmetic (GMROI, turnover, DIO) are implemented
in `scripts/retail_finance.py`.

## Questions this reference should let the skill answer

- **Which SKUs destroy working capital?** Low turnover + high average
  inventory cost, regardless of margin %.
- **Which products should be removed from smaller stores?** Slow-moving
  SKUs whose capacity could hold a faster-turning SKU — needs per-store
  sell-through, not network-average.
- **Which categories deserve more inventory?** High GMROI + evidence of
  stockouts (lost contribution from unmet demand) — a category is only a
  good expansion candidate if it's shown it can sell through faster
  restocking, not just that it has high margin today.
- **Which stores hold excess inventory?** Inventory Investment per Store
  relative to that store's revenue/COGS run-rate — a store carrying 45 days
  of stock against a 20-day network median is over-invested, not
  well-stocked.
- **Where does stockout create lost contribution?** Estimate lost units
  (from historical sell-through pattern during in-stock periods) ×
  contribution margin per unit — always label this an ESTIMATE, since the
  counterfactual demand is never a fact.
- **How much inventory can be reduced safely?** Bounded by the stockout
  risk it would introduce — never recommend a cut without stating the
  stockout-rate assumption behind it.

## A high-margin product is not automatically attractive

Compare, side by side, before recommending an assortment or purchasing
change: Revenue, Gross Profit (R$), Inventory Investment, Turnover, GMROI,
Stockout, Shrinkage, Waste, Contribution. A SKU that ranks well on margin %
but poorly on GMROI and turnover is consuming capital other SKUs could use
faster — flag it even if nobody asked about capital efficiency specifically.
