# Store Unit Economics

## The waterfall

```
Gross Revenue
- Discounts
- Returns
= Net Revenue

- COGS (CMV)
= Gross Profit

- Shrinkage / Theft            (loss not already netted into CMV)
- Expiration / Waste
- Payment Fees (card/PIX processor)
- Condominium / Location Commission
- Replenishment Cost (abastecimento labor/logistics for that store)
- Logistics Allocation (shared fleet/route cost attributed to the store)
- Store-specific Labor
- Electricity
- Connectivity
- Software / Platform Cost
- Maintenance
- Store-specific Operational Costs
= STORE CONTRIBUTION

- Allocated Corporate Costs (HQ, shared systems, management)
= FULLY ALLOCATED STORE PROFIT
```

**Keep Store Contribution and Fully Allocated Store Profit visibly
separate.** They answer different management questions:

- **Store Contribution** answers "does keeping this store open, as-is, add
  more cash than it costs?" — the right number for open/close/keep
  decisions, because corporate overhead mostly doesn't change if one store
  closes.
- **Fully Allocated Store Profit** answers "is the network's overhead
  structure sized right for the store base?" — the right number for
  expansion pace and corporate cost decisions, wrong number for a single
  store's close/keep call (closing a marginal store rarely removes its
  share of allocated overhead — the overhead just spreads over fewer
  stores).

Never present Fully Allocated Store Profit as if it were Store Contribution,
or a close recommendation built on it as if overhead would actually shrink.

## Mapping to what Agiliz.AI's platform actually computes

`finance-service` computes, per store/month, as FACTS (see
[../../../../backend/apps/finance-service/CLAUDE.md](../../../../backend/apps/finance-service/CLAUDE.md)):

| Platform field | Waterfall line |
|---|---|
| Valor abastecido (restocked value) | Input to COGS timing, not itself a P&L line |
| CMV (COGS) | `COGS` |
| Valor da sobra (remaining stock value) | Ending inventory investment, not a P&L line — see [inventory-finance.md](inventory-finance.md) |
| Perda real (real loss, by reason) | `Shrinkage/Theft` + `Expiration/Waste`, already split — do not re-classify |

Everything below Gross Profit in the waterfall (fees, commission, logistics,
labor, energy, software, maintenance, corporate allocation) is **not**
currently computed by any backend service — it must come from the human
(a document, an accounting export, or an explicit estimate) and be labeled
accordingly per [financial-decision-framework.md](financial-decision-framework.md).
Do not assume these costs are zero; an incomplete Store Contribution that
silently omits real costs looks *better* than reality, which is the failure
mode most likely to go unquestioned.

## Break-even

Break-even revenue (monthly) = Fixed store costs / Contribution margin %.
Break-even transactions = Break-even revenue / Average ticket.

Use `scripts/retail_finance.py::break_even_revenue` for the arithmetic once
fixed costs and contribution margin % are established as facts or labeled
assumptions.
