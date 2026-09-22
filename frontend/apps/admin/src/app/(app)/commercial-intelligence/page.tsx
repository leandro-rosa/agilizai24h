"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { CombosTab } from "@/components/commercial-intelligence/combos-tab";
import { DataQualityBanner } from "@/components/commercial-intelligence/data-quality-banner";
import { FiltersBar, type Comparison, type PeriodOption } from "@/components/commercial-intelligence/filters-bar";
import { HeldTab } from "@/components/commercial-intelligence/held-tab";
import { NoTransactionDetail } from "@/components/commercial-intelligence/no-transaction-detail";
import { OverviewTab } from "@/components/commercial-intelligence/overview-tab";
import { QualityTab } from "@/components/commercial-intelligence/quality-tab";
import { RUNTIME_PARAMETERS } from "@/components/commercial-intelligence/runtime-parameters";
import { BusinessRulesSheet } from "@/components/business-rules-sheet";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { NETWORK, type StoreSelection } from "@/components/store-period-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetCostsAsOfQuery, useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkReconciliationRangeQuery } from "@/lib/api/finance";
import { useGetNetworkSalesTransactionsQuery, type SalesTransaction, type StoreSalesTransactions } from "@/lib/api/sales";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useGetNetworkSupplyRangeQuery } from "@/lib/api/supply";
import { useHasPermission } from "@/lib/auth/use-permission";
import {
  assessAvailability,
  assessCouponGate,
  buildDataset,
  buildLossIndex,
  buildQualityItems,
  catalogVocabulary,
  computeMarginBreakdown,
  computeScopeKpis,
  costBySkuFrom,
  couponBiasDiagnostic,
  lossFigures,
  marginAfterLoss,
  marginByStore,
  partitionSynthetic,
  type SourceStatus,
} from "@/lib/commercial-intelligence";
import { ALLOW_SYNTHETIC } from "@/lib/commercial-intelligence/env";
import { commercialBusinessRuleRows } from "@/lib/commercial-intelligence/parameter-rows";
import { addMonths, lastCompleteMonth, monthsInRange } from "@/lib/period-range";
import { onlyOk } from "@/lib/sales-insights";

/** Where a secondary source stands, from what the query says and whether the viewer may read it. */
function sourceStatus(permitted: boolean, query: { isUninitialized: boolean; isLoading: boolean; isFetching: boolean; data?: unknown; error?: unknown }): SourceStatus {
  if (!permitted) return "no_permission";
  const status = query.error && typeof query.error === "object" && "status" in query.error ? (query.error as { status: unknown }).status : undefined;
  if (query.error) return status === 403 ? "no_permission" : "error";
  if (query.isUninitialized || query.isLoading || (query.isFetching && query.data === undefined)) return "loading";
  return "ok";
}

/** The transaction rows of the stores and products that may be analysed; synthetic ones never pass on the real gateway. */
function usableRows(data: StoreSalesTransactions[] | undefined, storeIds: ReadonlySet<number>, blockedSkus: ReadonlySet<string>): StoreSalesTransactions[] {
  if (!data) return [];
  return data
    .filter((row) => storeIds.has(row.storeId))
    .map((row) => (blockedSkus.size === 0 ? row : { ...row, transactions: row.transactions.filter((t) => !blockedSkus.has(t.sku)) }));
}

const inScope = (ok: SalesTransaction[], storeId: StoreSelection): SalesTransaction[] => (storeId === NETWORK || storeId === null ? ok : ok.filter((t) => t.store_id === storeId));

export default function CommercialIntelligencePage() {
  const [storeId, setStoreId] = useState<StoreSelection>(NETWORK);
  const [period, setPeriod] = useState<string>(() => lastCompleteMonth());
  const [comparison, setComparison] = useState<Comparison>("previous");

  // One set of parameters for everyone: the deployment's. Nothing that shapes a recommendation is chosen in a browser.
  const { parameters } = RUNTIME_PARAMETERS;

  const canProducts = useHasPermission("products:read");
  const canFinance = useHasPermission("finance:read");
  const canSupply = useHasPermission("supply:read");

  /* Period: the last 24 complete months plus the running one, labelled as such. */
  const currentMonth = useMemo(() => addMonths(lastCompleteMonth(), 1), []);
  const periodOptions = useMemo<PeriodOption[]>(() => {
    const complete = lastCompleteMonth();
    const past = monthsInRange({ start: addMonths(complete, -23), end: complete }).reverse();
    return [{ value: addMonths(complete, 1), inProgress: true }, ...past.map((value) => ({ value, inProgress: false }))];
  }, []);
  const periodInProgress = period === currentMonth;
  const comparePeriod = addMonths(period, -1);

  /* First wave: what the page cannot render without. */
  const stores = useGetStoresQuery();
  const products = useGetProductsQuery();
  const allStores = useMemo(() => stores.data ?? [], [stores.data]);

  // The transactions are always fetched at network width and filtered here, so switching the store issues no request.
  const current = useGetNetworkSalesTransactionsQuery({ stores: allStores, period }, { skip: allStores.length === 0 });
  const transactionsResolved = current.data !== undefined;

  /* Synthetic guard: on the real gateway a marked store or product takes part in nothing. */
  const storePartition = useMemo(() => partitionSynthetic(allStores, ALLOW_SYNTHETIC), [allStores]);
  const productPartition = useMemo(() => partitionSynthetic(products.data ?? [], ALLOW_SYNTHETIC), [products.data]);
  const keptStoreIds = useMemo(() => new Set(storePartition.kept.map((store) => store.id)), [storePartition]);
  const blockedSkus = useMemo(() => new Set(productPartition.excluded.map((product) => product.sku)), [productPartition]);
  const productBySku = useMemo(() => new Map(productPartition.kept.map((product) => [product.sku, product])), [productPartition]);
  const storeNameById = useMemo(() => new Map(allStores.map((store) => [store.id, store.name])), [allStores]);
  const storeName = useCallback((id: number) => storeNameById.get(id) ?? `Loja ${id}`, [storeNameById]);
  const categoryOf = useCallback((sku: string) => productBySku.get(sku)?.category ?? "sem categoria", [productBySku]);

  const currentRows = useMemo(() => usableRows(current.data, keptStoreIds, blockedSkus), [current.data, keptStoreIds, blockedSkus]);
  const okAll = useMemo(() => onlyOk(currentRows.flatMap((row) => row.transactions)), [currentRows]);
  const networkSkus = useMemo(() => [...new Set(okAll.map((t) => t.sku))].sort(), [okAll]);

  /* Second wave: only after the transactions resolve, to keep the first visit from opening ~100 requests at once. */
  const previous = useGetNetworkSalesTransactionsQuery({ stores: allStores, period: comparePeriod }, { skip: !transactionsResolved || comparison === "none" });
  const previousRows = useMemo(() => usableRows(previous.data, keptStoreIds, blockedSkus), [previous.data, keptStoreIds, blockedSkus]);
  const okPrevious = useMemo(() => onlyOk(previousRows.flatMap((row) => row.transactions)), [previousRows]);
  const previousSkus = useMemo(() => [...new Set(okPrevious.map((t) => t.sku))].sort(), [okPrevious]);

  // Costs are dated: the margin of each period uses the cost as it stood then. Keyed on the network's SKUs, so a store switch never refetches.
  const costs = useGetCostsAsOfQuery({ skus: networkSkus, asOf: `${period}-01` }, { skip: !canProducts || networkSkus.length === 0 });
  const costsPrevious = useGetCostsAsOfQuery({ skus: previousSkus, asOf: `${comparePeriod}-01` }, { skip: !canProducts || previousSkus.length === 0 || comparison === "none" });
  const reconciliation = useGetNetworkReconciliationRangeQuery(
    { stores: allStores, range: { start: addMonths(period, -5), end: period } },
    { skip: !transactionsResolved || !canFinance },
  );
  const supply = useGetNetworkSupplyRangeQuery({ stores: allStores, range: { start: period, end: period } }, { skip: !transactionsResolved || !canSupply });

  const costsStatus = sourceStatus(canProducts, costs);
  const reconciliationStatus = sourceStatus(canFinance, reconciliation);
  const supplyStatus = sourceStatus(canSupply, supply);

  /* The measurement layer. */
  const dataset = useMemo(() => buildDataset(currentRows, parameters), [currentRows, parameters]);
  const gate = useMemo(() => assessCouponGate(dataset, parameters), [dataset, parameters]);
  const diagnostic = useMemo(() => couponBiasDiagnostic(dataset.lines, categoryOf), [dataset, categoryOf]);

  const okScope = useMemo(() => inScope(okAll, storeId), [okAll, storeId]);
  const okPreviousScope = useMemo(() => inScope(okPrevious, storeId), [okPrevious, storeId]);
  const scopeStoreIds = useMemo(() => [...new Set(okScope.map((t) => t.store_id))].sort((a, b) => a - b), [okScope]);
  const previousScopeStoreIds = useMemo(() => [...new Set(okPreviousScope.map((t) => t.store_id))].sort((a, b) => a - b), [okPreviousScope]);

  const costBySku = useMemo(() => costBySkuFrom(costs.data?.resolved), [costs.data]);
  const costBySkuPrevious = useMemo(() => costBySkuFrom(costsPrevious.data?.resolved), [costsPrevious.data]);
  const kpis = useMemo(() => computeScopeKpis(okScope, costBySku), [okScope, costBySku]);

  // A comparison month with no rows is "Sem comparação", the same as one that failed: neither blocks the current period.
  const comparisonUsable = comparison === "previous" && previous.data !== undefined && okPrevious.length > 0;
  const kpisPrevious = useMemo(() => (comparisonUsable ? computeScopeKpis(okPreviousScope, costBySkuPrevious) : null), [comparisonUsable, okPreviousScope, costBySkuPrevious]);
  const comparisonMissing = comparison === "previous" && !previous.isLoading && !previous.isUninitialized && !comparisonUsable;

  const lossIndex = useMemo(() => buildLossIndex(reconciliation.data?.perStoreMonthly ?? [], period), [reconciliation.data, period]);
  const lossIndexPrevious = useMemo(() => buildLossIndex(reconciliation.data?.perStoreMonthly ?? [], comparePeriod), [reconciliation.data, comparePeriod]);
  const afterLossCurrent = useMemo(
    () => marginAfterLoss(scopeStoreIds, marginByStore(okScope, costBySku), lossFigures(lossIndex)),
    [scopeStoreIds, okScope, costBySku, lossIndex],
  );
  const afterLossPrevious = useMemo(
    () => (comparisonUsable ? marginAfterLoss(previousScopeStoreIds, marginByStore(okPreviousScope, costBySkuPrevious), lossFigures(lossIndexPrevious)) : null),
    [comparisonUsable, previousScopeStoreIds, okPreviousScope, costBySkuPrevious, lossIndexPrevious],
  );

  const vocabulary = useMemo(() => catalogVocabulary(okScope.map((t) => t.sku), categoryOf, parameters), [okScope, categoryOf, parameters]);
  const storesWithoutDetail = useMemo(
    () => storePartition.kept.filter((store) => (dataset.stores.get(store.id)?.okLines ?? 0) === 0).map((store) => store.name),
    [storePartition, dataset],
  );

  /* Availability: whether each analysis can run on the network's data, and why (D19). */
  const networkMargin = useMemo(() => computeMarginBreakdown(okAll, costBySku), [okAll, costBySku]);
  const networkStoreIds = useMemo(() => [...dataset.stores.values()].filter((store) => store.okLines > 0).map((store) => store.storeId), [dataset]);
  const monthsWithDetail = dataset.lines.length > 0 ? 1 + (comparisonUsable ? 1 : 0) : 0;
  const selectedStoreForAvailability = storeId === NETWORK || storeId === null ? null : storeId;
  const availability = useMemo(
    () =>
      assessAvailability(
        {
          gate,
          dataset,
          margin: networkMargin,
          costs: costsStatus,
          reconciliation: reconciliationStatus,
          lossIndex,
          scopeStoreIds: networkStoreIds,
          monthsWithDetail,
          selectedStoreId: selectedStoreForAvailability,
        },
        parameters,
      ),
    [gate, dataset, networkMargin, costsStatus, reconciliationStatus, lossIndex, networkStoreIds, monthsWithDetail, selectedStoreForAvailability, parameters],
  );

  const qualityItems = useMemo(
    () =>
      buildQualityItems(
        {
          gate,
          margin: kpis.margin,
          costs: costsStatus,
          reconciliation: reconciliationStatus,
          supply: supplyStatus,
          lossIndex,
          scopeStoreIds,
          storesWithoutDetail,
          storeName,
          vocabulary,
          periodInProgress,
          comparisonMissing,
          synthetic: {
            excludedStores: storePartition.excluded.map((store) => store.name),
            excludedProducts: productPartition.excluded.map((product) => product.name),
            allowed: ALLOW_SYNTHETIC,
          },
          parameterWarnings: RUNTIME_PARAMETERS.warnings,
        },
        parameters,
      ),
    [gate, kpis.margin, costsStatus, reconciliationStatus, supplyStatus, lossIndex, scopeStoreIds, storesWithoutDetail, storeName, vocabulary, periodInProgress, comparisonMissing, storePartition, productPartition, parameters],
  );

  /* Page-level state. Losing the transactions (or the catalog they are read against) is the only thing that stops the page. */
  const isLoading = stores.isLoading || products.isLoading || current.isLoading;
  const error = current.error ?? stores.error ?? products.error;
  // No completed line at all — a period before the per-store network format, or no store — reads as an explained empty state, never as zeros.
  const isEmpty = !isLoading && !error && dataset.lines.length === 0;
  const retry = () => {
    if (stores.error) void stores.refetch();
    if (products.error) void products.refetch();
    if (current.error) void current.refetch();
  };

  const selectedStoreId = storeId === NETWORK || storeId === null ? null : storeId;
  const scopeLabel = selectedStoreId === null ? "Rede" : storeName(selectedStoreId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inteligência Comercial"
        description="O que a rede vende junto, o que falta no carrinho, quais produtos rendem de verdade e onde as lojas se comportam diferente — sempre com a evidência, a confiança e o que não se sabe. Só sugere: nada é aplicado sozinho."
        actions={
          <>
            <BusinessRulesSheet
              description="Decisões da empresa que mudam o que a inteligência recomenda. Valem para toda a operação: não são ajustes deste navegador."
              rows={commercialBusinessRuleRows(parameters)}
              calibrationHref="/commercial-intelligence/calibration"
            />
            <Button asChild variant="ghost" size="sm">
              <Link href="/commercial-intelligence/calibration">Configurações avançadas / calibração</Link>
            </Button>
          </>
        }
      />

      <FiltersBar
        stores={storePartition.kept}
        storeId={storeId}
        onStoreChange={setStoreId}
        periodOptions={periodOptions}
        period={period}
        onPeriodChange={setPeriod}
        comparison={comparison}
        onComparisonChange={setComparison}
      />

      {/* When nothing is left to analyse, the reason still has to be visible: excluded synthetic data must not read as "no data". */}
      {isEmpty && <DataQualityBanner items={qualityItems.filter((item) => item.id.startsWith("synthetic") || item.id === "parameter-warnings")} />}

      {isEmpty ? (
        <NoTransactionDetail periodInProgress={periodInProgress} />
      ) : (
        <RequestState
          isLoading={isLoading}
          error={error}
          onRetry={retry}
          loadingRows={6}
        >
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Escopo: <strong className="font-medium text-foreground">{scopeLabel}</strong> · {scopeStoreIds.length} {scopeStoreIds.length === 1 ? "loja" : "lojas"} com detalhe de transação
            </p>

            <DataQualityBanner items={qualityItems} />

            <Tabs defaultValue="overview" className="gap-4">
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="overview">Visão geral</TabsTrigger>
                <TabsTrigger value="combos">Combos &amp; Cross-sell</TabsTrigger>
                <TabsTrigger value="products">Produtos</TabsTrigger>
                <TabsTrigger value="behavior">Comportamento</TabsTrigger>
                <TabsTrigger value="stores">Lojas</TabsTrigger>
                <TabsTrigger value="quality">Qualidade dos dados</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <OverviewTab
                  parameters={parameters}
                  scopeEmpty={okScope.length === 0}
                  scopeLabel={scopeLabel}
                  comparisonRequested={comparison === "previous"}
                  current={kpis}
                  previous={kpisPrevious}
                  costs={costsStatus}
                  afterLoss={{ status: reconciliationStatus, current: afterLossCurrent, previous: afterLossPrevious }}
                />
              </TabsContent>
              <TabsContent value="combos">
                <CombosTab gate={gate} diagnostic={diagnostic} parameters={parameters} storeName={storeName} selectedStoreId={selectedStoreId} />
              </TabsContent>
              <TabsContent value="products">
                <HeldTab title="Produtos com maior retorno financeiro" what="A classificação dos produtos pelo retorno depois das perdas — estrelas, motores de resultado, volume sem retorno, potencial subexplorado —, sempre relativa ao escopo." />
              </TabsContent>
              <TabsContent value="behavior">
                <HeldTab title="Comportamento por horário" what="O mapa de dia da semana × hora, as faixas do dia por categoria e as regras de concentração e de adesão por faixa." />
              </TabsContent>
              <TabsContent value="quality">
                <QualityTab availability={availability} />
              </TabsContent>
              <TabsContent value="stores">
                <HeldTab title="Lojas e lojas parecidas" what="O perfil de cada loja, comparada com as lojas de padrão de demanda parecido e com a referência da rede." />
              </TabsContent>
            </Tabs>
          </div>
        </RequestState>
      )}
    </div>
  );
}
