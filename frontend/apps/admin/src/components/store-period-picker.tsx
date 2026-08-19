"use client";

import { MonthRangePicker } from "@/components/month-range-picker";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetStoresQuery } from "@/lib/api/stores";
import type { PeriodRange } from "@/lib/period-range";

export const NETWORK = "network" as const;
export type StoreSelection = number | typeof NETWORK | null;

/**
 * Every real per-store screen (sales, supply, inventory, finance) reads one
 * store's data for a *range* of months — there is no "every store at once"
 * endpoint for any of them except finance's `/finance/rollup`, and no
 * finer-than-monthly grain anywhere. `allowNetwork` opts a screen into that
 * one exception, surfacing a "Rede (todas as lojas)" choice that resolves
 * to `NETWORK` rather than a store id.
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
