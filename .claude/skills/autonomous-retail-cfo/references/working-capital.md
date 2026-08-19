# Working Capital

## Components

- **Inventory** — see [inventory-finance.md](inventory-finance.md). The
  dominant working-capital component for this business; there is no
  meaningful Accounts Receivable in the core model (self-checkout, paid at
  point of sale) unless a specific arrangement with a host company/
  condominium introduces one — verify before assuming AR exists.
- **Accounts Payable** — supplier payment terms; see
  [supplier-economics.md](supplier-economics.md) for how to compare terms
  that trade a discount against payment days.
- **Accounts Receivable** — only where applicable (e.g. a corporate client
  billed monthly rather than paying at the point of sale). Do not model AR
  by default.

## Cash Conversion Cycle

```
CCC = DIO + DSO - DPO
```

- DIO — Days Inventory Outstanding, see
  [inventory-finance.md](inventory-finance.md).
- DSO — Days Sales Outstanding; 0 for point-of-sale revenue with no AR.
- DPO — Days Payable Outstanding, from actual supplier terms.

A shorter CCC means less cash tied up per R$ of revenue. Because DSO is
typically ~0 here, CCC is driven almost entirely by DIO and DPO — pushing
DPO out (within supplier-relationship limits, see
[supplier-economics.md](supplier-economics.md)) or turning inventory faster
are the two real levers.

## Working Capital Requirement (WCR)

WCR ≈ Inventory + AR − AP. For this business, absent AR, WCR ≈ Inventory −
AP. A new store's WCR is part of its true cash requirement alongside CAPEX —
see [store-expansion.md](store-expansion.md) — and part of the capital base
for ROIC, not just the CAPEX line.

## Supplier Payment Days

Track actual DPO by supplier, not a network average — a network DPO can look
healthy while one concentrated supplier is on unfavorable terms that expose
the network to that relationship. Cross-reference with
[supplier-economics.md](supplier-economics.md) before recommending a term
renegotiation.
