# Supplier Economics

## Don't decide on the nominal discount alone

Example: Supplier A offers R$100,000 payable in 45 days; Supplier B offers
R$96,000 cash. A 4% discount looks obviously better — it isn't, once
liquidity and the cost of capital are priced in.

## Implicit financing cost of an early/cash payment

Paying early to capture a discount is equivalent to investing cash at an
implied annualized rate. For a discount `d` (as a fraction) captured by
paying `n` days earlier than the standard term:

```
Implied annualized rate ≈ [d / (1 - d)] × (365 / n)
```

Example: 4% discount for paying 45 days early ≈ (0.04/0.96) × (365/45) ≈
33.8% annualized. Compare that to the business's actual cost of capital or
best alternative use of that cash (another store's ROIC, a supplier line of
credit rate, etc.) — see `scripts/retail_finance.py::implicit_financing_rate`.
If the implied rate beats the alternative, take the discount **only if
liquidity allows it without creating a cash shortfall** — check against the
cash forecast ([cash-management.md](cash-management.md)) before
recommending it.

## What else to weigh, beyond the implied rate

- **Available cash** — a mathematically attractive discount is worthless if
  taking it creates a liquidity gap; see
  [cash-management.md](cash-management.md).
- **Inventory turnover of the goods involved** — paying cash for slow-moving
  stock ties up capital twice (in the payment and in the resulting
  inventory); see [inventory-finance.md](inventory-finance.md).
- **Payment terms as working capital** — longer terms extend DPO and shorten
  the cash conversion cycle; see [working-capital.md](working-capital.md).
  A term extension can be worth more than a small discount.
- **Concentration risk** — a large volume shift to one supplier for a better
  price increases dependency; note it even when the math favors the switch.
- **Service level / stockout risk** — a cheaper or more favorable-terms
  supplier that delivers less reliably can cost more in lost contribution
  from stockouts than it saves; see
  [retail-kpis.md](retail-kpis.md#inventory).
- **Purchasing volume** — whether the comparison holds at actual order
  volumes, or only at a minimum-order threshold that changes the real unit
  economics.

## Output shape

State the implied annualized rate, the liquidity check result, and the
non-price factors above, then recommend — do not stop at "Option B is 4%
cheaper."
