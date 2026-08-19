# Store P&L — [Store name] — [Period]

Basis: FACT / DERIVED / ASSUMPTION / ESTIMATE tagged per line. Source for
each FACT line stated inline.

| Line | R$ | Basis | Source |
|---|---:|---|---|
| Gross Revenue | | | |
| − Discounts | | | |
| − Returns | | | |
| **= Net Revenue** | | | |
| − COGS (CMV) | | FACT | `finance-service` |
| **= Gross Profit** | | DERIVED | |
| Gross Margin % | | DERIVED | |
| − Shrinkage/Theft | | FACT | `finance-service` (perda real) |
| − Expiration/Waste | | FACT | `finance-service` (perda real) |
| − Payment Fees | | | |
| − Location Commission | | | |
| − Replenishment Cost | | | |
| − Logistics Allocation | | | |
| − Store Labor | | | |
| − Electricity | | | |
| − Connectivity | | | |
| − Software/Platform | | | |
| − Maintenance | | | |
| − Other Store Opex | | | |
| **= STORE CONTRIBUTION** | | DERIVED | |
| Contribution Margin % | | DERIVED | |
| − Allocated Corporate Costs | | | |
| **= FULLY ALLOCATED STORE PROFIT** | | DERIVED | |

## Inventory position (not a P&L line, tracked alongside)

| | Value | Basis | Source |
|---|---:|---|---|
| Remaining stock value (sobra) | | FACT | `finance-service` |
| Inventory turnover (period) | | DERIVED | |
| GMROI | | DERIVED | |

## Notes

- Any line without a `finance-service` source is not yet computed by the
  platform — see
  [../references/store-unit-economics.md](../references/store-unit-economics.md).
- Flag `finance-service` completeness (`complete`/`unvalued`/
  `inconsistent_stock`) for this period before treating the COGS/loss lines
  as final — see
  [../references/cash-management.md](../references/cash-management.md).
