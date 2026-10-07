"use client";

import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PricingStatus } from "@/lib/api/pricing";
import { STATUS_LABEL } from "@/lib/pricing/labels";
import { activeFilterCount, MARGIN_BAND_LABEL, NO_FILTERS, SORT_LABEL, type Filters, type MarginBand, type SortKey } from "@/lib/pricing/view";

const ALL = "__all";

function FilterSelect({
  label,
  value,
  onChange,
  options,
  width = "sm:w-44",
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: { value: string; label: string }[];
  width?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
      <SelectTrigger className={width} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todos</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Filtros combináveis e ordenação. Cada filtro ativo tem seu próprio controle para sair; "Limpar" tira todos. */
export function FiltersBar({
  filters,
  onChange,
  sort,
  onSortChange,
  categories,
  suppliers,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  categories: { key: string; label: string }[];
  suppliers: { id: number; name: string }[];
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const active = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-3" role="search" aria-label="Filtros de produtos">
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
        <div className="relative lg:w-72">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filters.query} onChange={(event) => set({ query: event.target.value })} placeholder="Buscar produto, código ou EAN…" aria-label="Buscar produto" className="pl-8" />
        </div>
        <FilterSelect label="Categoria" value={filters.category} onChange={(category) => set({ category })} options={categories.map((c) => ({ value: c.key, label: c.label }))} />
        <FilterSelect label="Fornecedor" value={filters.supplierId === null ? null : String(filters.supplierId)} onChange={(value) => set({ supplierId: value === null ? null : Number(value) })} options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))} />
        <FilterSelect label="Situação" value={filters.status} onChange={(status) => set({ status: status as PricingStatus | null })} options={(Object.keys(STATUS_LABEL) as PricingStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <FilterSelect label="Faixa de margem" value={filters.marginBand} onChange={(marginBand) => set({ marginBand: marginBand as MarginBand | null })} options={(Object.keys(MARGIN_BAND_LABEL) as MarginBand[]).map((b) => ({ value: b, label: MARGIN_BAND_LABEL[b] }))} width="sm:w-52" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={filters.belowTarget ? "default" : "outline"} aria-pressed={filters.belowTarget} onClick={() => set({ belowTarget: !filters.belowTarget })}>
          Abaixo da meta
        </Button>
        <Button type="button" size="sm" variant={filters.costChanged ? "default" : "outline"} aria-pressed={filters.costChanged} onClick={() => set({ costChanged: !filters.costChanged })}>
          Com alteração de custo
        </Button>

        {active > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(NO_FILTERS)}>
            <X aria-hidden />
            Limpar filtros ({active})
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span id="sort-label">Ordenar por</span>
          <Select value={sort} onValueChange={(value) => onSortChange(value as SortKey)}>
            <SelectTrigger className="w-52" aria-labelledby="sort-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SORT_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
