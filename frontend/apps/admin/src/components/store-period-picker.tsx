"use client";

import { MonthRangePicker } from "@/components/month-range-picker";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetStoresQuery } from "@/lib/api/stores";
import type { PeriodRange } from "@/lib/period-range";

export const NETWORK = "network" as const;
export type StoreSelection = number | typeof NETWORK | null;

/**
 * Every real per-store screen (sales, supply, inventory, finance) reads one
 * store's data for a *range* of months — none of the four has a real
 * "every store at once, over a range" endpoint. finance-service's
 * `GET /finance/rollup?period=` totals the network for a single month, not
 * a range, so it isn't used here either: every `allowNetwork` screen fans
 * out one request per store (finance: one call per store, its full series;
 * sales/supply/inventory: one call per store per month) and sums
 * client-side (`getNetworkReconciliationRange`, `getNetworkSalesRange`,
 * `getNetworkSupplyRange`, `getNetworkStockRange`). `allowNetwork` surfaces
 * the "Rede (todas as lojas)" choice that resolves to `NETWORK` rather than
 * a store id.
 */
export function StorePeriodPicker({
  storeId,
  onStoreIdChange,
  range,
  onRangeChange,
  allowNetwork = false,
}: {
  storeId: StoreSelection;
  onStoreIdChange: (id: StoreSelection) => void;
  range: PeriodRange;
  onRangeChange: (range: PeriodRange) => void;
  allowNetwork?: boolean;
}) {
  const { data: stores, isLoading } = useGetStoresQuery();

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Select
        value={storeId === null ? undefined : String(storeId)}
        onValueChange={(value) => onStoreIdChange(value === NETWORK ? NETWORK : Number(value))}
        disabled={isLoading}
      >
        <SelectTrigger className="sm:w-64">
          <SelectValue placeholder={isLoading ? "Carregando lojas..." : "Selecione a loja"} />
        </SelectTrigger>
        <SelectContent>
          {allowNetwork && (
            <>
              <SelectItem value={NETWORK}>Rede (todas as lojas)</SelectItem>
              <SelectSeparator />
            </>
          )}
          {(stores ?? []).map((store) => (
            <SelectItem key={store.id} value={String(store.id)}>
              {store.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MonthRangePicker value={range} onChange={onRangeChange} />
    </div>
  );
}
