"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { BehaviorTab } from "@/components/sales/behavior-tab";
import { OverviewTab } from "@/components/sales/overview-tab";
import { PaymentsTab } from "@/components/sales/payments-tab";
import { ProductsTab } from "@/components/sales/products-tab";
import { StoresTab } from "@/components/sales/stores-tab";
import { NETWORK, type StoreSelection } from "@/components/store-period-picker";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BulkCostResult, Product } from "@/lib/api/products";
import { useGetCostsAsOfQuery, useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkSalesTransactionsQuery, type SalesTransaction } from "@/lib/api/sales";
import { useGetStoresQuery, type Store } from "@/lib/api/stores";
import type { CostBySku } from "@/lib/sales-insights";
import { onlyOk } from "@/lib/sales-insights";
import { addMonths, lastCompleteMonth, monthsInRange } from "@/lib/period-range";

function costBySkuFrom(bulk: BulkCostResult | undefined): CostBySku | null {
  if (!bulk) return null;
  const map = new Map<string, number>();
  for (const resolved of bulk.resolved) map.set(resolved.sku, resolved.cost_cents);
  return map;
}

function byStore(
  data: { storeId: number; transactions: SalesTransaction[] }[] | undefined,
  stores: Store[],
): { store: Store; transactions: SalesTransaction[] }[] {
  if (!data) return [];
  const storeById = new Map(stores.map((s) => [s.id, s]));
  return data.flatMap((row) => {
    const store = storeById.get(row.storeId);
    return store ? [{ store, transactions: row.transactions }] : [];
  });
}

export default function SalesPage() {
  const [storeId, setStoreId] = useState<StoreSelection>(null);
  const [period, setPeriod] = useState(lastCompleteMonth());
  const [comparePeriod, setComparePeriod] = useState(addMonths(lastCompleteMonth(), -1));

  const periodOptions = useMemo(() => {
    const anchor = period > lastCompleteMonth() ? period : lastCompleteMonth();
    return monthsInRange({ start: addMonths(anchor, -23), end: anchor }).slice().reverse();
  }, [period]);

  const { data: stores } = useGetStoresQuery();
  const { data: products } = useGetProductsQuery();
  const allStores = useMemo(() => stores ?? [], [stores]);
  const isNetworkScope = storeId === NETWORK;
  const skipNetwork = allStores.length === 0 || storeId === null;

  // Always fetched at network width, regardless of the selected scope: "loja
  // vs rede" is a first-class comparison throughout this page (spec section
  // 5), so a store-scoped view still needs the network's own numbers as a
  // benchmark. Selecting a single store never triggers a second fetch —
  // it's the same {allStores, period} cache entry, just filtered client-side.
  const {
    data: networkCurrentData,
    isLoading: loadingCurrent,
    error: currentError,
    refetch: refetchCurrent,
  } = useGetNetworkSalesTransactionsQuery({ stores: allStores, period }, { skip: skipNetwork });
  const { data: networkPreviousData, isLoading: loadingPrevious } = useGetNetworkSalesTransactionsQuery(
    { stores: allStores, period: comparePeriod },
    { skip: skipNetwork },
  );

  const productBySku = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products ?? []) map.set(product.sku, product);
    return map;
  }, [products]);

  const networkCurrentByStore = useMemo(() => byStore(networkCurrentData, allStores), [networkCurrentData, allStores]);
  const networkPreviousByStore = useMemo(() => byStore(networkPreviousData, allStores), [networkPreviousData, allStores]);

  const currentByStore = useMemo(
    () => (isNetworkScope ? networkCurrentByStore : networkCurrentByStore.filter((row) => row.store.id === storeId)),
    [isNetworkScope, networkCurrentByStore, storeId],
  );
  const previousByStore = useMemo(
    () => (isNetworkScope ? networkPreviousByStore : networkPreviousByStore.filter((row) => row.store.id === storeId)),
    [isNetworkScope, networkPreviousByStore, storeId],
  );

  const allCurrent = useMemo(() => currentByStore.flatMap((row) => row.transactions), [currentByStore]);
  const allPrevious = useMemo(() => previousByStore.flatMap((row) => row.transactions), [previousByStore]);
  const okCurrent = useMemo(() => onlyOk(allCurrent), [allCurrent]);
  const okPrevious = useMemo(() => onlyOk(allPrevious), [allPrevious]);

  const skusInScope = useMemo(() => [...new Set(okCurrent.map((t) => t.sku))], [okCurrent]);
  const skusInPreviousScope = useMemo(() => [...new Set(okPrevious.map((t) => t.sku))], [okPrevious]);
  const { data: costsBulk } = useGetCostsAsOfQuery(
    { skus: skusInScope, asOf: `${period}-01` },
    { skip: skusInScope.length === 0 },
  );
  // Costs are dated/versioned — a fair "previous period" margin needs the
  // cost as it stood then, not today's, even though the two rarely differ.
  const { data: costsBulkPrevious } = useGetCostsAsOfQuery(
    { skus: skusInPreviousScope, asOf: `${comparePeriod}-01` },
    { skip: skusInPreviousScope.length === 0 },
  );
  const costBySku = useMemo(() => costBySkuFrom(costsBulk), [costsBulk]);
  const costBySkuPrevious = useMemo(() => costBySkuFrom(costsBulkPrevious), [costsBulkPrevious]);

  const isLoading = loadingCurrent || loadingPrevious;
  const isEmpty = !isLoading && !currentError && allCurrent.length === 0;

  const sharedProps = {
    isNetworkScope,
    scopedStores: currentByStore.map((r) => r.store),
    currentByStore,
    previousByStore,
    networkCurrentByStore,
    networkPreviousByStore,
    okCurrent,
    okPrevious,
    allCurrent,
    allPrevious,
    productBySku,
    costBySku,
    costBySkuPrevious,
    period,
    comparePeriod,
    isLoading,
    error: currentError,
    isEmpty,
    onRetry: refetchCurrent,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vendas"
        description="Onde, quando, como e o que a rede vende — a partir do detalhe por transação, quando disponível para o período."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Loja</span>
          <Select
            value={storeId === null ? undefined : String(storeId)}
            onValueChange={(value) => setStoreId(value === NETWORK ? NETWORK : Number(value))}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Selecione a loja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NETWORK}>Rede (todas as lojas)</SelectItem>
              <SelectSeparator />
              {(stores ?? []).map((store) => (
                <SelectItem key={store.id} value={String(store.id)}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Período</span>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Comparar com</span>
          <Select value={comparePeriod} onValueChange={setComparePeriod}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions
                .filter((m) => m !== period)
                .map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">
          Selecione uma loja, ou &ldquo;Rede (todas as lojas)&rdquo;, para ver as vendas do período.
        </p>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="products">Produtos</TabsTrigger>
            <TabsTrigger value="stores">Lojas</TabsTrigger>
            <TabsTrigger value="behavior">Comportamento</TabsTrigger>
            <TabsTrigger value="payments">Pagamentos</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab {...sharedProps} />
          </TabsContent>
          <TabsContent value="products">
            <ProductsTab {...sharedProps} />
          </TabsContent>
          <TabsContent value="stores">
            <StoresTab {...sharedProps} storeId={storeId === NETWORK ? null : storeId} />
          </TabsContent>
          <TabsContent value="behavior">
            <BehaviorTab {...sharedProps} />
          </TabsContent>
          <TabsContent value="payments">
            <PaymentsTab {...sharedProps} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
