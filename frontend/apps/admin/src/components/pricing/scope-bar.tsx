"use client";

import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { period as formatPeriod } from "@/lib/format";
import { addMonths, lastCompleteMonth } from "@/lib/period-range";
import { useGetStoresQuery } from "@/lib/api/stores";

const NETWORK = "network";
const MONTHS_OFFERED = 12;

/** Os últimos meses fechados, do mais novo para o mais antigo. O mês corrente nunca tem relatório fechado. */
export function monthOptions(last: string = lastCompleteMonth()): string[] {
  return Array.from({ length: MONTHS_OFFERED }, (_, index) => addMonths(last, -index));
}

/** Mês e loja do relatório. "Todas as lojas" analisa a rede inteira. */
export function ScopeBar({
  period,
  onPeriodChange,
  storeId,
  onStoreIdChange,
}: {
  period: string;
  onPeriodChange: (period: string) => void;
  storeId: number | null;
  onStoreIdChange: (storeId: number | null) => void;
}) {
  const { data: stores, isLoading } = useGetStoresQuery();
  const months = monthOptions();
  const offered = months.includes(period) ? months : [period, ...months];

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select value={period} onValueChange={onPeriodChange}>
        <SelectTrigger className="sm:w-36" aria-label="Período">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {offered.map((month) => (
            <SelectItem key={month} value={month}>
              {formatPeriod(month)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={storeId === null ? NETWORK : String(storeId)} onValueChange={(value) => onStoreIdChange(value === NETWORK ? null : Number(value))} disabled={isLoading}>
        <SelectTrigger className="sm:w-56" aria-label="Loja">
          <SelectValue placeholder="Loja" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NETWORK}>Todas as lojas</SelectItem>
          <SelectSeparator />
          {(stores ?? []).map((store) => (
            <SelectItem key={store.id} value={String(store.id)}>
              {store.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
