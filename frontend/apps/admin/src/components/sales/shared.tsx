"use client";

import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import type { SerializedError } from "@reduxjs/toolkit";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Product } from "@/lib/api/products";
import type { SalesTransaction } from "@/lib/api/sales";
import type { Store } from "@/lib/api/stores";
import type { CostBySku, SalesKpi } from "@/lib/sales-insights";

/**
 * Every tab reads the same base dataset (current/previous period
 * transactions, per store, plus product/cost lookups) — computed once in
 * `page.tsx` and passed down, rather than each of the 5 tabs re-fetching
 * and re-deriving it.
 */
export interface SalesTabProps {
  isNetworkScope: boolean;
  scopedStores: Store[];
  currentByStore: { store: Store; transactions: SalesTransaction[] }[];
  previousByStore: { store: Store; transactions: SalesTransaction[] }[];
  /** Always the whole network, regardless of the selected scope — the benchmark "loja vs rede" comparisons read against. */
  networkCurrentByStore: { store: Store; transactions: SalesTransaction[] }[];
  networkPreviousByStore: { store: Store; transactions: SalesTransaction[] }[];
  /** Flattened across the whole scope, `result === 'OK'` only. */
  okCurrent: SalesTransaction[];
  okPrevious: SalesTransaction[];
  /** Every result, including declined/cancelled — for "Resultado das transações" only. */
  allCurrent: SalesTransaction[];
  allPrevious: SalesTransaction[];
  productBySku: Map<string, Product>;
  costBySku: CostBySku | null;
  costBySkuPrevious: CostBySku | null;
  period: string;
  comparePeriod: string;
  isLoading: boolean;
  error?: FetchBaseQueryError | SerializedError;
  isEmpty: boolean;
  onRetry: () => void;
}

export const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact" });

export function DeltaTag({ deltaPct, deltaIsBad }: { deltaPct: number | null; deltaIsBad: boolean | null }) {
  if (deltaPct === null || deltaIsBad === null) {
    return <span className="text-xs text-muted-foreground">sem comparação</span>;
  }
  if (Math.abs(deltaPct) < 0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" /> estável
      </span>
    );
  }
  const Icon = deltaPct > 0 ? TrendingUp : TrendingDown;
  const tone = deltaIsBad ? "text-destructive" : "text-success";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${tone}`}>
      <Icon className="size-3" />
      {`${deltaPct > 0 ? "+" : ""}${(deltaPct * 100).toFixed(1)}${Math.abs(deltaPct) < 1 ? "%" : "×"}`}
    </span>
  );
}

export function SalesKpiCard({ kpi }: { kpi: SalesKpi }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
          {kpi.label}
          {kpi.hint && (
            <span title={kpi.hint}>
              <AlertTriangle className="size-3.5" />
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="tabular text-xl font-semibold">{kpi.displayValue ?? currency.format((kpi.valueCents ?? 0) / 100)}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          {kpi.secondaryLabel && <span className="text-xs text-muted-foreground">{kpi.secondaryLabel}</span>}
          <DeltaTag deltaPct={kpi.deltaPct} deltaIsBad={kpi.deltaIsBad} />
        </div>
      </CardContent>
    </Card>
  );
}

export function SimpleKpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="tabular text-xl font-semibold">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
