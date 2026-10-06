"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
import { SUPPLIER_CATEGORIES, SUPPLIER_CATEGORY_LABELS, useGetSuppliersQuery } from "@/lib/api/suppliers";
import { addMonths, lastCompleteMonth } from "@/lib/period-range";
import { formatMonth } from "@/lib/supplier-analysis/format";

type Mode = "supplier" | "product";
const ALL = "all";

function periodOptions(current: string): string[] {
  return Array.from({ length: 18 }, (_, i) => addMonths(current, -i));
}

export default function PurchasesPage() {
  const latest = useMemo(() => lastCompleteMonth(), []);
  const [mode, setMode] = useState<Mode>("supplier");
  const [period, setPeriod] = useState(latest);
  const [compareTo, setCompareTo] = useState<CompareTo>("prev_month");
  const [category, setCategory] = useState(ALL);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [productLabel, setProductLabel] = useState("");
  const [storeId, setStoreId] = useState(ALL);

  const suppliersQuery = useGetSuppliersQuery({ status: "active" });
  const productsQuery = useGetProductsQuery();
  const storesQuery = useGetStoresQuery();

  const suppliers = suppliersQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const labelOf = (product: { name: string; sku: string }) => `${product.name} (${product.sku})`;
  const product = products.find((p) => labelOf(p) === productLabel);
  const supplier = suppliers.find((s) => s.id === supplierId);
  // Só entra no seletor quem tem produto vinculado (o vínculo vem da planilha de precificação):
  // o cadastro tem banco, software e outros que nunca aparecem em compra de mercadoria.
  const linkedSupplierIds = useMemo(() => new Set(products.flatMap((p) => (p.supplier_id == null ? [] : [p.supplier_id]))), [products]);
  const analysedSuppliers = suppliers.filter((s) => linkedSupplierIds.has(s.id));
  const visibleSuppliers = category === ALL ? analysedSuppliers : analysedSuppliers.filter((s) => s.category === category);
  const store = storeId === ALL ? undefined : Number(storeId);

  const base = { period, compareTo, storeId: store };
  const supplierQuery = useGetSupplierAnalysisQuery({ ...base, supplierId: supplierId ?? 0 }, { skip: mode !== "supplier" || supplierId === null });
  const crossQuery = useGetCrossAnalysisQuery(
    { period, compareTo, supplierId: supplierId ?? 0, sku: product?.sku ?? "" },
    { skip: mode !== "supplier" || supplierId === null || !product },
  );
  const productQuery = useGetProductAnalysisQuery({ ...base, sku: product?.sku ?? "" }, { skip: mode !== "product" || !product });

  // O produto de um fornecedor sai da lista de produtos: o filtro cruzado só oferece os que ele tem.
  const supplierProductLabels = products.filter((p) => p.supplier_id === supplierId).map(labelOf);
  const productOptions = mode === "supplier" ? supplierProductLabels : products.map(labelOf);

  function selectProductFromSupplier(sku: string) {
    const found = products.find((p) => p.sku === sku);
    if (found) setProductLabel(labelOf(found));
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Compras e Fornecedores"
        description="Acompanhe o que foi comprado, abastecido, vendido e perdido."
        actions={
          <div className="flex items-center gap-1">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-36" aria-label="Período">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodOptions(latest).map((p) => (
                  <SelectItem key={p} value={p}>
                    {formatMonth(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => setPeriod(addMonths(period, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Próximo mês" disabled={period >= latest} onClick={() => setPeriod(addMonths(period, 1))}>
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
                    {visibleSuppliers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
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
                  <input type="radio" name="compare" checked={compareTo === option} onChange={() => setCompareTo(option)} />
                  {option === "prev_month" ? "Mês anterior" : "Média 3 meses"}
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
