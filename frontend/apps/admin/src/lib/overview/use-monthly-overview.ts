"use client";

import { useMemo } from "react";

import { useGetPnlByStoreQuery, useGetPnlSeriesQuery } from "@/lib/api/accounting";
import { useGetAgingQuery } from "@/lib/api/billing";
import { useGetAllContributionsQuery, useGetItemsQuery } from "@/lib/api/capex";
import { useGetNetworkFinanceSeriesQuery } from "@/lib/api/finance";
import { useGetCostsAsOfQuery, useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesByStoreMonthQuery } from "@/lib/api/sales";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useGetTreasuryMonthsQuery } from "@/lib/api/treasury";
import { addMonths, monthsInRange } from "@/lib/period-range";
import { capexMonth, cashMonth, financeMonth, investorMonth, pnlMonth, storePnl, treasuryMonth } from "./assemble";
import { buildOverview } from "./build";
import type { Overview, OverviewInput } from "./types";

const EMPTY: never[] = [];

/** Competências disponíveis = meses com DRE da rede FECHADO (accounting). */
export function useClosedPeriods() {
  const { data, isLoading, isError } = useGetPnlSeriesQuery({});
  const periods = useMemo(
    () => (data ?? EMPTY).filter((s) => s.store_id === null && s.status === "closed").map((s) => s.period).sort().reverse(),
    [data],
  );
  return { periods, isLoading, isError };
}

export interface SectionState {
  pnl: boolean;
  treasury: boolean;
  finance: boolean;
  sales: boolean;
  stores: boolean;
  capex: boolean;
  investors: boolean;
  aging: boolean;
}

/**
 * Compõe as queries existentes de cada serviço. Cada seção falha
 * isoladamente: o que não respondeu entra como `null` no motor e vira
 * "Indisponível" na tela — nunca um zero.
 */
export function useMonthlyOverview(period: string | null) {
  const skip = period === null;
  const p = period ?? "1970-01";
  const previous = addMonths(p, -1);

  const stores = useGetStoresQuery(undefined, { skip });
  const products = useGetProductsQuery(undefined, { skip });
  const pnlSeries = useGetPnlSeriesQuery({}, { skip });
  const periods = useMemo(() => [p, addMonths(p, -1), addMonths(p, -2), addMonths(p, -3)], [p]);
  const treasury = useGetTreasuryMonthsQuery({ periods }, { skip });
  const finance = useGetNetworkFinanceSeriesQuery({ stores: stores.data ?? EMPTY }, { skip: skip || !stores.data });
  const byStoreNow = useGetPnlByStoreQuery({ period: p }, { skip });
  const byStorePrev = useGetPnlByStoreQuery({ period: previous }, { skip });
  const items = useGetItemsQuery(undefined, { skip });
  const contributions = useGetAllContributionsQuery(undefined, { skip });
  const aging = useGetAgingQuery(undefined, { skip });
  const salesRange = useMemo(() => ({ start: addMonths(p, -5), end: p }), [p]);
  const sales = useGetNetworkSalesByStoreMonthQuery({ stores: stores.data ?? EMPTY, range: salesRange }, { skip: skip || !stores.data });

  const cells = useMemo(
    () => (sales.data ?? EMPTY).flatMap((m) => m.bySku.map((r) => ({ storeId: m.storeId, period: m.period, sku: r.sku, quantity: r.quantity_sold, revenueCents: r.revenue_cents }))),
    [sales.data],
  );
  const skus = useMemo(() => [...new Set(cells.map((c) => c.sku))], [cells]);
  const costs = useGetCostsAsOfQuery({ skus, asOf: `${p}-01` }, { skip: skip || skus.length === 0 });

  const overview: Overview | null = useMemo(() => {
    if (period === null || !pnlSeries.data) return null;
    const names = new Map((stores.data ?? EMPTY).map((s) => [s.id, s.name]));
    const treasuryByPeriod = new Map((treasury.data ?? EMPTY).map((t) => [t.period, t]));
    const months = periods.map((per) => ({
      period: per,
      pnl: pnlMonth(pnlSeries.data, per),
      cash: cashMonth(treasuryByPeriod.get(per)?.cash),
      treasury: treasuryMonth(treasuryByPeriod.get(per)?.summary),
      finance: financeMonth(finance.data, per),
      capex: capexMonth(items.data, per),
      investors: investorMonth(contributions.data, per),
    }));
    const ingested = [...new Set((sales.data ?? EMPTY).map((m) => m.period))];
    const input: OverviewInput = {
      period,
      months,
      stores: {
        current: storePnl(byStoreNow.data, names),
        previous: storePnl(byStorePrev.data, names),
        activeCount: stores.data ? stores.data.filter((s) => s.status === "active").length : null,
      },
      sales: sales.data ? { cells, ingestedPeriods: ingested, seriesPeriods: monthsInRange(salesRange) } : null,
      costBySku: costs.data ? Object.fromEntries(costs.data.resolved.map((r) => [r.sku, r.cost_cents])) : null,
      storeList: stores.data ? stores.data.filter((x) => x.status === "active").map((x) => ({ id: x.id, name: x.name })) : null,
      productNames: Object.fromEntries((products.data ?? EMPTY).map((x) => [x.sku, x.name])),
      aging: aging.data
        ? {
            referenceDate: aging.data.reference_date,
            overdueCents: aging.data.overdue_amount_cents,
            notDueCents: aging.data.buckets.find((b) => b.key === "not_due")?.amount_cents ?? 0,
            openCents: aging.data.open_amount_cents,
          }
        : null,
      closed: pnlSeries.data.some((s) => s.period === period && s.store_id === null && s.status === "closed"),
    };
    return buildOverview(input);
  }, [period, periods, pnlSeries.data, stores.data, treasury.data, finance.data, items.data, contributions.data, byStoreNow.data, byStorePrev.data, sales.data, cells, salesRange, costs.data, products.data, aging.data]);

  const unavailable: SectionState = {
    pnl: pnlSeries.isError,
    treasury: treasury.isError,
    finance: finance.isError,
    sales: sales.isError,
    stores: byStoreNow.isError || byStorePrev.isError,
    capex: items.isError,
    investors: contributions.isError,
    aging: aging.isError,
  };

  return {
    overview,
    unavailable,
    isLoading: !skip && (pnlSeries.isLoading || stores.isLoading),
    /** Produtos/finance ainda chegando — a tela mostra esqueleto no bloco, não bloqueia o resto. */
    productsLoading: sales.isLoading || costs.isLoading || products.isLoading,
    financeLoading: finance.isLoading,
    refetch: () => {
      pnlSeries.refetch();
    },
  };
}
