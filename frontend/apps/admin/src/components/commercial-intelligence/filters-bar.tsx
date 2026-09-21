"use client";

import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NETWORK, type StoreSelection } from "@/components/store-period-picker";
import type { Store } from "@/lib/api/stores";
import { period as periodLabel } from "@/lib/format";

export type Comparison = "previous" | "none";

export interface PeriodOption {
  value: string;
  inProgress: boolean;
}

/**
 * Store or network, period, comparison and category. Only the period and the
 * comparison change what is requested; the store and the category are read
 * from what is already loaded, so switching them never issues a request.
 *
 * The category filter is present but switched off until the analyses that use
 * it are released: a control that does nothing would read as broken.
 */
export function FiltersBar({
  stores,
  storeId,
  onStoreChange,
  periodOptions,
  period,
  onPeriodChange,
  comparison,
  onComparisonChange,
}: {
  stores: Store[];
  storeId: StoreSelection;
  onStoreChange: (id: StoreSelection) => void;
  periodOptions: PeriodOption[];
  period: string;
  onPeriodChange: (period: string) => void;
  comparison: Comparison;
  onComparisonChange: (comparison: Comparison) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground" id="ci-filter-store">
            Loja
          </span>
          <Select value={storeId === null ? NETWORK : String(storeId)} onValueChange={(value) => onStoreChange(value === NETWORK ? NETWORK : Number(value))}>
            <SelectTrigger className="w-60" aria-labelledby="ci-filter-store">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NETWORK}>Rede (todas as lojas)</SelectItem>
              <SelectSeparator />
              {stores.map((store) => (
                <SelectItem key={store.id} value={String(store.id)}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground" id="ci-filter-period">
            Período
          </span>
          <Select value={period} onValueChange={onPeriodChange}>
            <SelectTrigger className="w-52" aria-labelledby="ci-filter-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {periodLabel(option.value)}
                  {option.inProgress ? " — em andamento" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground" id="ci-filter-comparison">
            Comparar com
          </span>
          <Select value={comparison} onValueChange={(value) => onComparisonChange(value as Comparison)}>
            <SelectTrigger className="w-44" aria-labelledby="ci-filter-comparison">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="previous">Mês anterior</SelectItem>
              <SelectItem value="none">Sem comparação</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground" id="ci-filter-category">
            Categoria
          </span>
          <Select value="all" disabled>
            <SelectTrigger className="w-44" aria-labelledby="ci-filter-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        O catálogo tem só quatro categorias — refeição, snack, bebida e essencial — e o filtro segue o cadastro, sem deduzir nada do nome do produto. A categoria filtra as listas
        das abas de análise e nunca as cestas em si; ela liga junto com essas análises, hoje em espera.
      </p>
    </div>
  );
}
