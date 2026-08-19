"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetStoresQuery } from "@/lib/api/stores";

/** The current month as YYYY-MM — every real backend period grain. */
export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Every real per-store screen (sales, supply, inventory, finance) reads one
 * store's one period at a time — there is no "every store at once" endpoint
 * for any of them. This is the one control all four share.
 */
export function StorePeriodPicker({
  storeId,
  onStoreIdChange,
  period,
  onPeriodChange,
}: {
  storeId: number | null;
  onStoreIdChange: (id: number) => void;
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  const { data: stores, isLoading } = useGetStoresQuery();

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Select
        value={storeId === null ? undefined : String(storeId)}
        onValueChange={(value) => onStoreIdChange(Number(value))}
        disabled={isLoading}
      >
        <SelectTrigger className="sm:w-64">
          <SelectValue placeholder={isLoading ? "Carregando lojas..." : "Selecione a loja"} />
        </SelectTrigger>
        <SelectContent>
          {(stores ?? []).map((store) => (
            <SelectItem key={store.id} value={String(store.id)}>
              {store.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        type="month"
        value={period}
        onChange={(event) => onPeriodChange(event.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-40"
        aria-label="Período (mês)"
      />
    </div>
  );
}
