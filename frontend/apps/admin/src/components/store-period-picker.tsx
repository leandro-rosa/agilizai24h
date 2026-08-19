"use client";

import { MonthPicker } from "@/components/month-picker";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetStoresQuery } from "@/lib/api/stores";

/**
 * The default period a screen opens to — the last **complete** calendar
 * month, as YYYY-MM.
 *
 * Deliberately not the current month: it is still in progress, so it never
 * has a real restocking/sales file behind it yet. Landing there by default
 * made every screen's first impression a scary "reconciliation incomplete"
 * or "no data" state for a month nobody could have reconciled yet — not a
 * bug, just the wrong month to default to.
 */
export function currentPeriod(): string {
  const now = new Date();
  const lastComplete = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${lastComplete.getFullYear()}-${String(lastComplete.getMonth() + 1).padStart(2, "0")}`;
}

export const NETWORK = "network" as const;
export type StoreSelection = number | typeof NETWORK | null;

/**
 * Every real per-store screen (sales, supply, inventory, finance) reads one
 * store's one period at a time — there is no "every store at once" endpoint
 * for any of them except finance's `/finance/rollup`. `allowNetwork` opts a
 * screen into that one exception, surfacing a "Rede (todas as lojas)" choice
 * that resolves to `NETWORK` rather than a store id.
 */
export function StorePeriodPicker({
  storeId,
  onStoreIdChange,
  period,
  onPeriodChange,
  allowNetwork = false,
}: {
  storeId: StoreSelection;
  onStoreIdChange: (id: StoreSelection) => void;
  period: string;
  onPeriodChange: (period: string) => void;
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
      <MonthPicker value={period} onChange={onPeriodChange} />
    </div>
  );
}
