# Cash and Treasury

## Cash decisions prioritize liquidity before accounting profit

Distinguish, explicitly, in any cash-related output:

- **Profit** — accounting result (revenue minus costs), can be positive
  while cash is tight (e.g. inventory build, receivable timing, CAPEX not
  yet depreciated but already paid).
- **Cash Flow** — actual cash in/out over a period.
- **Free Cash Flow** — Cash Flow from Operations minus CAPEX.
- **Working Capital** — see [working-capital.md](working-capital.md).
- **Available Cash** — the actual liquid balance, the number a runway
  question is really asking about.

A store or the network can be profitable and still run out of cash — never
answer a liquidity question with a profit number.

## 13-week cash forecast

Direct-method: schedule known weekly receipts and disbursements (supplier
payments, payroll, CAPEX, tax when known, debt service, planned inventory
purchases) rather than smoothing a monthly figure into weeks — the lumps
(a large restock, a quarterly tax payment) are exactly what the forecast
needs to surface. Show the **raw**, unfinanced cash position — a projected
negative week means "this is the deadline to arrange financing or defer a
payment," not "hide it by assuming a credit line already exists." Report the
trough amount, the week it occurs, and the first negative week.

## Monthly cash forecast

Roll the 13-week schedule (or, absent weekly granularity, monthly actuals)
forward against planned CAPEX, inventory purchases, debt service, and known
seasonal effects (see [scenario-analysis.md](scenario-analysis.md) for
driver sensitivity). State the minimum liquidity threshold explicitly if the
human has set one; otherwise flag that no minimum-liquidity policy is
established yet in `.fpa/business-profile.md`.

## Contingency scenarios

Pair every cash forecast presented as a base case with at least a downside
variant when the underlying revenue/margin/timing assumptions are uncertain
— see [scenario-analysis.md](scenario-analysis.md).

## Judgment checks before trusting a cash or profit number

Numbers can be arithmetically correct and still misleading. Before stating a
conclusion:

- **Is the period actually closed?** Costs that post late (e.g. a supplier
  invoice not yet received, cost-sheet updates in `products-service` that
  haven't triggered a recompute) make an in-flight month look better than it
  is. `finance-service` marks incompleteness explicitly (`complete`,
  `unvalued`, `inconsistent_stock` per-SKU) — read those flags before citing
  a month's figures as final.
- **Which cash are you quoting?** Bank balance and ledger cash rarely tie
  out intraday. State which one.
- **Is a one-time item inflating or depressing the number?** A single
  unusually large restock, a one-off commission dispute, a bulk supplier
  discount — flag it and show the run-rate with and without it.
- **Are you comparing complete months?** A rollup or trend line that mixes
  a complete month with an in-flight one will look like a fake spike or dip.
