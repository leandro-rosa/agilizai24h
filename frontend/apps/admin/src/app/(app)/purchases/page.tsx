"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { DateRangePicker, type DayRange as PickerRange } from "@/components/date-range-picker";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ProductView } from "@/components/supplier-analysis/product-view";
import { SupplierView } from "@/components/supplier-analysis/supplier-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetStoresQuery } from "@/lib/api/stores";
import {
  useGetCrossAnalysisQuery,
  useGetProductAnalysisQuery,
  useGetSupplierAnalysisQuery,
  type CompareTo,
} from "@/lib/api/supplier-analysis";
import { SUPPLIER_CATEGORIES, SUPPLIER_CATEGORY_LABELS, suppliersApi, useGetSuppliersQuery } from "@/lib/api/suppliers";
import { useAppDispatch } from "@/lib/hooks";
import { lastCompleteMonth } from "@/lib/period-range";
import {
  clampRange,
  dayCount,
  isWholeMonths,
  lastDayOfMonth,
  lastDays,
  MAX_RANGE_DAYS,
  monthRange,
  monthsEndingAt,
  shiftRange as shiftDayRange,
  type DayRange,
} from "@/lib/supplier-analysis/day-range";
import { supplierLabel } from "@/lib/supplier-analysis/supplier-label";

type Mode = "supplier" | "product";
const ALL = "all";

export default function PurchasesPage() {
  const latest = useMemo(() => lastCompleteMonth(), []);
  const [mode, setMode] = useState<Mode>("supplier");
  const latestDay = useMemo(() => lastDayOfMonth(latest), [latest]);
  const [range, setRange] = useState<DayRange>(() => monthRange(latest));
  // O calendário escolhe a ponta inicial antes da final: o rascunho mostra o clique sem consultar a API.
  const [draft, setDraft] = useState<PickerRange | null>(null);
  const [compareChoice, setCompareChoice] = useState<CompareTo>("prev_month");
  // A média de 3 meses é de um mês inteiro só; qualquer outro intervalo se compara com o período imediatamente anterior.
  const singleMonth = isWholeMonths(range) && range.from.slice(0, 7) === range.to.slice(0, 7);
  const compareTo: CompareTo = singleMonth ? compareChoice : "prev_month";
  const [category, setCategory] = useState(ALL);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [productLabel, setProductLabel] = useState("");
  const [storeId, setStoreId] = useState(ALL);

  const suppliersQuery = useGetSuppliersQuery({ status: "active" });
  const productsQuery = useGetProductsQuery();
  const storesQuery = useGetStoresQuery();

  const suppliers = suppliersQuery.data ?? [];
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const labelOf = (product: { name: string; sku: string }) => `${product.name} (${product.sku})`;
  const product = products.find((p) => labelOf(p) === productLabel);
  const supplier = suppliers.find((s) => s.id === supplierId);
  // Só entra no seletor quem tem produto vinculado (o vínculo vem da planilha de precificação):
  // o cadastro tem banco, software e outros que nunca aparecem em compra de mercadoria.
  const linkedSupplierIds = useMemo(() => new Set(products.flatMap((p) => (p.supplier_id == null ? [] : [p.supplier_id]))), [products]);
  const analysedSuppliers = suppliers.filter((s) => linkedSupplierIds.has(s.id));

  // O seletor mostra a grafia da planilha, que está nos aliases do fornecedor.
  const dispatch = useAppDispatch();
  const [aliases, setAliases] = useState<Map<number, string[]>>(new Map());
  const analysedKey = analysedSuppliers.map((s) => s.id).join(",");
  useEffect(() => {
    const ids = analysedKey ? analysedKey.split(",").map(Number) : [];
    let cancelled = false;
    Promise.all(ids.map((id) => dispatch(suppliersApi.endpoints.getSupplier.initiate(id)).unwrap().catch(() => null))).then((details) => {
      if (!cancelled) setAliases(new Map(details.flatMap((d) => (d ? [[d.id, d.aliases.map((a) => a.alias)] as [number, string[]]] : []))));
    });
    return () => {
      cancelled = true;
    };
  }, [analysedKey, dispatch]);
  const labelOfSupplier = (s: { id: number; name: string }) => supplierLabel(s.name, aliases.get(s.id) ?? []);
  const visibleSuppliers = category === ALL ? analysedSuppliers : analysedSuppliers.filter((s) => s.category === category);
  const store = storeId === ALL ? undefined : Number(storeId);

  const base = { fromDate: range.from, toDate: range.to, compareTo, storeId: store };
  const supplierQuery = useGetSupplierAnalysisQuery({ ...base, supplierId: supplierId ?? 0 }, { skip: mode !== "supplier" || supplierId === null });
  const crossQuery = useGetCrossAnalysisQuery(
    { fromDate: range.from, toDate: range.to, compareTo, supplierId: supplierId ?? 0, sku: product?.sku ?? "" },
    { skip: mode !== "supplier" || supplierId === null || !product },
  );
  const productQuery = useGetProductAnalysisQuery({ ...base, sku: product?.sku ?? "" }, { skip: mode !== "product" || !product });

  // O produto de um fornecedor sai da lista de produtos: o filtro cruzado só oferece os que ele tem.
  const supplierProductLabels = products.filter((p) => p.supplier_id === supplierId).map(labelOf);
  const productOptions = mode === "supplier" ? supplierProductLabels : products.map(labelOf);

  function applyRange(next: DayRange) {
    const { range: fitted, clamped } = clampRange(next);
    if (clamped) toast.info(`O período vai até ${MAX_RANGE_DAYS} dias; mostrando os últimos ${MAX_RANGE_DAYS} até o dia final.`);
    setRange(fitted);
    setDraft(null);
  }

  function onPick(picked: PickerRange) {
    if (picked.from && picked.to) applyRange({ from: picked.from, to: picked.to });
    else if (picked.from) setDraft(picked);
    else setDraft(null);
  }

  /** Desloca o intervalo pelo próprio tamanho, sem passar do último dia fechado. */
  function shift(direction: -1 | 1) {
    const next = shiftDayRange(range, direction, latestDay);
    if (next) applyRange(next);
  }

  const presets: { label: string; range: DayRange }[] = [
    { label: "Mês", range: monthRange(latest) },
    { label: "30 dias", range: lastDays(latestDay, 30) },
    { label: "Trimestre", range: monthsEndingAt(latestDay, 3) },
    { label: "Semestre", range: monthsEndingAt(latestDay, 6) },
    { label: "Ano", range: monthsEndingAt(latestDay, 12) },
  ];

  function selectProductFromSupplier(sku: string) {
    const found = products.find((p) => p.sku === sku);
    if (found) setProductLabel(labelOf(found));
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Compras e Fornecedores"
        description="Acompanhe o que foi comprado, abastecido, vendido e perdido."
        actions={
          <div className="flex items-center gap-1">
            <DateRangePicker value={draft ?? range} onChange={onPick} />
            <Button variant="outline" size="icon" aria-label="Período anterior" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Próximo período" disabled={shiftDayRange(range, 1, latestDay) === null} onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
        <TabsList>
          <TabsTrigger value="supplier">Por fornecedor</TabsTrigger>
          <TabsTrigger value="product">Por produto</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-1.5" aria-label="Atalhos de período">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            size="sm"
            variant={preset.range.from === range.from && preset.range.to === range.to ? "secondary" : "outline"}
            onClick={() => applyRange(preset.range)}
          >
            {preset.label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">{dayCount(range)} dias · até {MAX_RANGE_DAYS}</span>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-4">
          {mode === "supplier" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Categoria
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas</SelectItem>
                    {SUPPLIER_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {SUPPLIER_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Fornecedor
                <Select
                  value={supplierId === null ? "" : String(supplierId)}
                  onValueChange={(value) => {
                    setSupplierId(Number(value));
                    setProductLabel("");
                  }}
                >
                  <SelectTrigger className="w-64" aria-label="Fornecedor">
                    <SelectValue placeholder="Escolha o fornecedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...visibleSuppliers].sort((a, b) => labelOfSupplier(a).localeCompare(labelOfSupplier(b), "pt-BR")).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {labelOfSupplier(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Produto
            <Combobox
              options={productOptions}
              value={productLabel}
              onChange={setProductLabel}
              placeholder={mode === "supplier" ? "Todos (ou cruzar com um produto)" : "Pesquise um produto"}
              className="w-72"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Loja
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-52" aria-label="Loja">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {(storesQuery.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <fieldset className="flex flex-col gap-1 text-xs text-muted-foreground">
            <legend>Comparar com</legend>
            <div className="flex gap-3 text-sm text-foreground">
              {(["prev_month", "avg_3m"] as const).map((option) => (
                <label key={option} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="compare"
                    checked={compareTo === option}
                    disabled={option === "avg_3m" && !singleMonth}
                    onChange={() => setCompareChoice(option)}
                  />
                  {option === "prev_month" ? (singleMonth ? "Mês anterior" : "Período anterior") : "Média 3 meses"}
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      {store !== undefined && (
        <p className="text-xs text-muted-foreground">Com uma loja filtrada, compras (que são da rede) aparecem como “—”.</p>
      )}

      {mode === "supplier" ? (
        supplierId === null || !supplier ? (
          <RequestState isLoading={suppliersQuery.isLoading} error={suppliersQuery.error} isEmpty emptyMessage="Escolha um fornecedor para ver a movimentação.">
            {null}
          </RequestState>
        ) : (
          <RequestState isLoading={supplierQuery.isFetching && !supplierQuery.data} error={supplierQuery.error} onRetry={supplierQuery.refetch} loadingRows={6}>
            {supplierQuery.data && (
              <SupplierView
                supplier={supplier}
                analysis={supplierQuery.data}
                products={products}
                compareTo={compareTo}
                cross={product ? crossQuery.data : undefined}
                onSelectProduct={selectProductFromSupplier}
              />
            )}
          </RequestState>
        )
      ) : !product ? (
        <RequestState isLoading={productsQuery.isLoading} error={productsQuery.error} isEmpty emptyMessage="Pesquise um produto para ver a movimentação.">
          {null}
        </RequestState>
      ) : (
        <RequestState isLoading={productQuery.isFetching && !productQuery.data} error={productQuery.error} onRetry={productQuery.refetch} loadingRows={6}>
          {productQuery.data && (
            <ProductView
              product={product}
              analysis={productQuery.data}
              supplier={suppliers.find((s) => s.id === product.supplier_id)}
              suppliers={suppliers}
              compareTo={compareTo}
            />
          )}
        </RequestState>
      )}
    </div>
  );
}
