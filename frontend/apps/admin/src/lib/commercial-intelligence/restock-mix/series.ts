import type { Store } from "@/lib/api/stores";
import type { StoreMonthSales } from "@/lib/api/sales";
import type { StoreMonthSupply } from "@/lib/api/supply";
import type { PerStoreMonthlyTotal } from "@/lib/api/finance";
import type { StoreSkuMonth, StoreSkuSeries } from "./types";

/**
 * Combina vendas, abastecimento e perdas (já buscados pelo caller, mesmos
 * hooks que o Loss Intelligence usa) numa série mensal por loja×SKU. Emite
 * um `StoreSkuMonth` por período de `periods` para todo par loja×SKU que
 * teve QUALQUER atividade (venda, abastecimento ou perda) em algum mês da
 * janela — nunca um período pulado, mesmo que o valor daquele mês seja zero
 * (a série precisa ter comprimento fixo para o cálculo de tendência, Task 2).
 */
export function buildStoreSkuSeries(
  _stores: Store[],
  salesByStoreMonth: StoreMonthSales[],
  supplyByStoreMonth: StoreMonthSupply[],
  reconciliationByStoreMonth: PerStoreMonthlyTotal[],
  periods: string[],
): StoreSkuSeries[] {
  type Cell = { vendido: number; abastecido: number; perdido: number; receitaCents: number };
  const byStoreSku = new Map<string, Map<string, Map<string, Cell>>>();

  function cellFor(storeId: number, sku: string, period: string): Cell {
    const key = String(storeId);
    if (!byStoreSku.has(key)) byStoreSku.set(key, new Map());
    const bySku = byStoreSku.get(key)!;
    if (!bySku.has(sku)) bySku.set(sku, new Map());
    const byPeriod = bySku.get(sku)!;
    if (!byPeriod.has(period)) byPeriod.set(period, { vendido: 0, abastecido: 0, perdido: 0, receitaCents: 0 });
    return byPeriod.get(period)!;
  }

  for (const month of salesByStoreMonth) {
    for (const row of month.bySku) {
      const cell = cellFor(month.storeId, row.sku, month.period);
      cell.vendido += row.quantity_sold;
      cell.receitaCents += row.revenue_cents;
    }
  }

  for (const month of supplyByStoreMonth) {
    for (const row of month.restocks) {
      cellFor(month.storeId, row.sku, month.period).abastecido += row.quantity_restocked;
    }
  }

  for (const row of reconciliationByStoreMonth) {
    for (const entry of row.totals.loss_by_reason_sku) {
      cellFor(row.storeId, entry.sku, row.period).perdido += entry.quantity;
    }
  }

  const result: StoreSkuSeries[] = [];
  for (const [storeIdStr, bySku] of byStoreSku) {
    const storeId = Number(storeIdStr);
    for (const [sku, byPeriod] of bySku) {
      const meses: StoreSkuMonth[] = periods.map((period) => {
        const cell = byPeriod.get(period);
        return { period, vendido: cell?.vendido ?? 0, abastecido: cell?.abastecido ?? 0, perdido: cell?.perdido ?? 0, receitaCents: cell?.receitaCents ?? 0 };
      });
      const hasActivity = meses.some((m) => m.vendido > 0 || m.abastecido > 0 || m.perdido > 0);
      if (hasActivity) result.push({ storeId, sku, meses });
    }
  }

  return result;
}
