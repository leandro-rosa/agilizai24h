"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

import { BusinessRulesSheet } from "@/components/business-rules-sheet";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BalanceQualityTab } from "@/components/commercial-intelligence/balance-quality/balance-quality-tab";
import { MixDrawer, type MixDrawerRow } from "@/components/commercial-intelligence/mix/mix-drawer";
import { MixTable, type MixDisplayRow, type MixOpportunityRow } from "@/components/commercial-intelligence/mix/mix-table";
import { RestockDrawer } from "@/components/commercial-intelligence/restock/restock-drawer";
import { RestockPanel } from "@/components/commercial-intelligence/restock/restock-panel";
import { RestockTable, type RestockDisplayRow } from "@/components/commercial-intelligence/restock/restock-table";
import { useGetCostsAsOfQuery, useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkReconciliationRangeQuery } from "@/lib/api/finance";
import { useGetNetworkMinimumsQuery } from "@/lib/api/inventory";
import { useGetNetworkSalesByStoreMonthQuery } from "@/lib/api/sales";
import { useGetNetworkSupplyByStoreMonthQuery } from "@/lib/api/supply";
import { useGetStoresQuery } from "@/lib/api/stores";
import { monthRange } from "@/lib/format";
import type { StoreSkuParametrizacao } from "@/lib/commercial-intelligence/restock-mix/types";
import { partitionSynthetic } from "@/lib/commercial-intelligence/synthetic";
import { ALLOW_SYNTHETIC } from "@/lib/commercial-intelligence/env";
import { computeMixOpportunities, computeMixRecommendations, type MixEngineInput } from "@/lib/commercial-intelligence/restock-mix/mix/engine";
import { mixBusinessRuleRows } from "@/lib/commercial-intelligence/restock-mix/mix/parameter-rows";
import { RUNTIME_MIX_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/mix/parameters";
import { computeRestockRecommendations, type RestockEngineInput } from "@/lib/commercial-intelligence/restock-mix/restock/engine";
import { restockBusinessRuleRows } from "@/lib/commercial-intelligence/restock-mix/restock/parameter-rows";
import { RUNTIME_RESTOCK_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/restock/parameters";
import { analyzeLossIntelligence } from "@/lib/loss-intelligence/engine";
import { RUNTIME_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossIntelligenceInput } from "@/lib/loss-intelligence/types";
import { addMonths, lastCompleteMonth, type PeriodRange } from "@/lib/period-range";

export default function CommercialIntelligencePage() {
  const { data: stores, error: storesError, refetch: refetchStores } = useGetStoresQuery();
  const { data: products, error: productsError, refetch: refetchProducts } = useGetProductsQuery();
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("abastecimento");

  const storePartition = useMemo(() => partitionSynthetic(stores ?? [], ALLOW_SYNTHETIC), [stores]);
  const scopedStores = storePartition.kept;
  const productPartition = useMemo(() => partitionSynthetic(products ?? [], ALLOW_SYNTHETIC), [products]);
  const scopedProducts = productPartition.kept;
  const skip = scopedStores.length === 0;

  // Mesma janela do Loss Intelligence (Global Constraint) — nunca uma janela própria.
  const engineAsOfPeriod = lastCompleteMonth();
  const lookbackMonths = RUNTIME_PARAMETERS.parameters.window.recurrenceLookbackMonths;
  const engineRange = useMemo<PeriodRange>(() => ({ start: addMonths(engineAsOfPeriod, -(lookbackMonths - 1)), end: engineAsOfPeriod }), [engineAsOfPeriod, lookbackMonths]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const {
    data: reconciliationRange,
    isLoading: loadingReconciliation,
    error,
    refetch: refetchReconciliation,
  } = useGetNetworkReconciliationRangeQuery({ stores: scopedStores, range: engineRange }, { skip });
  const {
    data: salesByStoreMonth,
    isLoading: loadingSales,
    error: salesError,
    refetch: refetchSales,
  } = useGetNetworkSalesByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });
  const {
    data: supplyByStoreMonth,
    isLoading: loadingSupply,
    error: supplyError,
    refetch: refetchSupply,
  } = useGetNetworkSupplyByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });
  const {
    data: minimums,
    isLoading: loadingMinimums,
    error: minimumsError,
    refetch: refetchMinimums,
  } = useGetNetworkMinimumsQuery({ stores: scopedStores }, { skip });

  const parametrizacaoBySkuStore = useMemo(() => {
    const map = new Map<string, StoreSkuParametrizacao>();
    for (const item of minimums ?? []) {
      map.set(`${item.store_id}:${item.sku}`, {
        minimo: item.minimum ?? null,
        nivelDePar: item.par_level ?? null,
        quantidadeAtual: item.current_quantity ?? null,
        quantidadeAtualEm: item.current_quantity_as_of ?? null,
      });
    }
    return map;
  }, [minimums]);

  const parametrizacaoFor = useCallback(
    (storeId: number, sku: string) => parametrizacaoBySkuStore.get(`${storeId}:${sku}`) ?? null,
    [parametrizacaoBySkuStore],
  );

  const allSkusForCost = useMemo(() => [...new Set((salesByStoreMonth ?? []).flatMap((month) => month.bySku.map((row) => row.sku)))], [salesByStoreMonth]);
  const {
    data: costsResult,
    isLoading: loadingCosts,
    error: costsError,
    refetch: refetchCosts,
  } = useGetCostsAsOfQuery({ skus: allSkusForCost, asOf: `${engineAsOfPeriod}-01` }, { skip: allSkusForCost.length === 0 });
  const costsBySkuAsOf = useMemo(() => {
    if (!costsResult) return null;
    const bySku = new Map(costsResult.resolved.map((r) => [r.sku, r.cost_cents]));
    return (sku: string) => bySku.get(sku) ?? null;
  }, [costsResult]);

  const reconciliationByStoreMonth = reconciliationRange?.perStoreMonthly;

  const lossIntelligenceInput = useMemo<LossIntelligenceInput | null>(() => {
    if (!reconciliationByStoreMonth || !salesByStoreMonth || !supplyByStoreMonth || !costsBySkuAsOf || scopedStores.length === 0) return null;
    return {
      reconciliations: reconciliationByStoreMonth.map((row) => ({
        store_id: row.storeId,
        period: row.period,
        loss_by_reason_sku: row.totals.loss_by_reason_sku.map((entry) => ({ reason: entry.reason, sku: entry.sku, quantity: entry.quantity, value_cents: entry.value_cents })),
      })),
      salesByStorePeriodSku: salesByStoreMonth.flatMap((month) => month.bySku.map((row) => ({ store_id: month.storeId, period: month.period, sku: row.sku, quantity_sold: row.quantity_sold, revenue_cents: row.revenue_cents }))),
      supplyByStorePeriodSku: supplyByStoreMonth.flatMap((month) => month.restocks.map((row) => ({ store_id: month.storeId, period: month.period, sku: row.sku, quantity_restocked: row.quantity_restocked }))),
      costsBySkuAsOf,
      stores: scopedStores.map((s) => ({ id: s.id, name: s.name })),
      today,
      parameters: RUNTIME_PARAMETERS.parameters,
    };
  }, [reconciliationByStoreMonth, salesByStoreMonth, supplyByStoreMonth, costsBySkuAsOf, scopedStores, today]);

  const lossResult = useMemo(() => (lossIntelligenceInput ? analyzeLossIntelligence(lossIntelligenceInput) : null), [lossIntelligenceInput]);

  const restockRecommendations = useMemo(() => {
    if (!lossResult || !scopedProducts.length || !salesByStoreMonth || !supplyByStoreMonth || !reconciliationByStoreMonth) return [];
    const input: RestockEngineInput = {
      stores: scopedStores, products: scopedProducts, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, lossResult, today,
      lossParameters: RUNTIME_PARAMETERS.parameters, restockParameters: RUNTIME_RESTOCK_PARAMETERS.parameters, parametrizacaoFor,
    };
    return computeRestockRecommendations(input);
  }, [lossResult, scopedProducts, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, scopedStores, today, parametrizacaoFor]);

  const mixEngineInput = useMemo<MixEngineInput | null>(() => {
    if (!lossResult || !scopedProducts.length || !salesByStoreMonth || !supplyByStoreMonth || !reconciliationByStoreMonth || !costsBySkuAsOf) return null;
    return {
      stores: scopedStores, products: scopedProducts, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, lossResult, today,
      lossParameters: RUNTIME_PARAMETERS.parameters, mixParameters: RUNTIME_MIX_PARAMETERS.parameters, costsBySkuAsOf, parametrizacaoFor,
    };
  }, [lossResult, scopedProducts, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, costsBySkuAsOf, scopedStores, today, parametrizacaoFor]);

  const mixRecommendations = useMemo(() => (mixEngineInput ? computeMixRecommendations(mixEngineInput) : []), [mixEngineInput]);
  const mixOpportunities = useMemo(() => (mixEngineInput ? computeMixOpportunities(mixEngineInput) : []), [mixEngineInput]);

  const nameBySku = useMemo(() => new Map(scopedProducts.map((p) => [p.sku, p.name])), [scopedProducts]);
  const storeById = useMemo(() => new Map(scopedStores.map((s) => [s.id, s])), [scopedStores]);
  const storeName = useCallback((id: number) => storeById.get(id)?.name ?? String(id), [storeById]);

  const restockDisplayRows: RestockDisplayRow[] = useMemo(() => {
    if (selectedStoreId === null) return [];
    const recomendacoes: RestockDisplayRow[] = restockRecommendations
      .filter((r) => r.storeId === selectedStoreId)
      .map((r) => ({ kind: "recomendacao", productLabel: nameBySku.get(r.sku) ?? r.sku, storeName: storeName(r.storeId), data: r }));
    const oportunidades: RestockDisplayRow[] = mixOpportunities
      .filter((o) => o.storeId === selectedStoreId)
      .map((o) => ({ kind: "oportunidade", productLabel: nameBySku.get(o.sku) ?? o.sku, storeName: storeName(o.storeId), data: o }));
    return [...recomendacoes, ...oportunidades];
  }, [restockRecommendations, mixOpportunities, selectedStoreId, nameBySku, storeName]);

  const mixDisplayRows: MixDisplayRow[] = useMemo(() => {
    if (selectedStoreId === null) return [];
    return mixRecommendations.filter((r) => r.storeId === selectedStoreId).map((r) => ({ productLabel: nameBySku.get(r.sku) ?? r.sku, storeName: storeName(r.storeId), data: r }));
  }, [mixRecommendations, selectedStoreId, nameBySku, storeName]);

  const mixOpportunityRows: MixOpportunityRow[] = useMemo(() => {
    if (selectedStoreId === null) return [];
    return mixOpportunities.filter((o) => o.storeId === selectedStoreId).map((o) => ({ productLabel: nameBySku.get(o.sku) ?? o.sku, storeName: storeName(o.storeId), data: o }));
  }, [mixOpportunities, selectedStoreId, nameBySku, storeName]);

  const [selectedRestockRow, setSelectedRestockRow] = useState<RestockDisplayRow | null>(null);
  const [selectedMixRow, setSelectedMixRow] = useState<MixDrawerRow | null>(null);

  const combinedError = error ?? storesError ?? productsError ?? salesError ?? supplyError ?? costsError ?? minimumsError;
  const isLoading = loadingReconciliation || loadingSales || loadingSupply || loadingCosts || loadingMinimums;
  const isEmpty = !isLoading && !combinedError && selectedStoreId !== null && restockDisplayRows.length === 0 && mixDisplayRows.length === 0;

  const retryAll = useCallback(() => {
    refetchStores();
    refetchProducts();
    refetchReconciliation();
    refetchSales();
    refetchSupply();
    refetchCosts();
    refetchMinimums();
  }, [refetchStores, refetchProducts, refetchReconciliation, refetchSales, refetchSupply, refetchCosts, refetchMinimums]);

  const windowLabel = useMemo(
    () => `Base da recomendação: últimos ${lookbackMonths} meses fechados (${monthRange(engineRange.start, engineRange.end)})`,
    [engineRange, lookbackMonths],
  );

  const businessRuleRows = useMemo(
    () => [...restockBusinessRuleRows(RUNTIME_RESTOCK_PARAMETERS.parameters), ...mixBusinessRuleRows(RUNTIME_MIX_PARAMETERS.parameters)],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inteligência Comercial"
        description="A IA analisa vendas, abastecimentos, margem e perdas para sugerir o que levar para cada loja e quais produtos deveriam existir nela."
        actions={
          <>
            <BusinessRulesSheet
              description="Decisões da empresa que mudam o que a inteligência recomenda para Abastecimento e Mix. Valem para toda a operação: não são ajustes deste navegador."
              rows={businessRuleRows}
              calibrationHref="/commercial-intelligence/calibration"
            />
            <Button asChild variant="ghost" size="sm">
              <Link href="/commercial-intelligence/calibration">Configurações avançadas / calibração</Link>
            </Button>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
        <TabsList>
          <TabsTrigger value="abastecimento">Abastecimento Inteligente</TabsTrigger>
          <TabsTrigger value="mix">Mix das Lojas</TabsTrigger>
          <TabsTrigger value="saldo">Qualidade do saldo</TabsTrigger>
        </TabsList>

        {/* A loja só importa para as duas análises por loja; a qualidade do saldo é da rede inteira. */}
        {activeTab !== "saldo" && (
          <Select
            value={selectedStoreId === null ? undefined : String(selectedStoreId)}
            onValueChange={(value) => {
              setSelectedStoreId(Number(value));
              setSelectedRestockRow(null);
              setSelectedMixRow(null);
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Selecione a loja" />
            </SelectTrigger>
            <SelectContent>
              {scopedStores.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <TabsContent value="abastecimento" className="flex flex-col gap-4">
          {selectedStoreId === null ? (
            <p className="text-sm text-muted-foreground">Selecione uma loja para ver as recomendações de abastecimento e mix.</p>
          ) : (
            <RequestState isLoading={isLoading} error={combinedError} isEmpty={isEmpty} emptyMessage="Sem dados suficientes nesta loja para calcular recomendações." onRetry={retryAll}>
              <p className="text-sm text-muted-foreground">A IA analisa vendas, abastecimentos, margem e perdas para sugerir o que levar para cada loja.</p>
              <RestockPanel rows={restockDisplayRows} windowLabel={windowLabel} />
              <RestockTable rows={restockDisplayRows} onSelect={setSelectedRestockRow} />
              <RestockDrawer row={selectedRestockRow} open={selectedRestockRow !== null} onOpenChange={(open) => !open && setSelectedRestockRow(null)} />
            </RequestState>
          )}
        </TabsContent>

        <TabsContent value="mix" className="flex flex-col gap-4">
          {selectedStoreId === null ? (
            <p className="text-sm text-muted-foreground">Selecione uma loja para ver as recomendações de abastecimento e mix.</p>
          ) : (
            <RequestState isLoading={isLoading} error={combinedError} isEmpty={isEmpty} emptyMessage="Sem dados suficientes nesta loja para calcular recomendações." onRetry={retryAll}>
              <p className="text-sm text-muted-foreground">Quais produtos deveriam existir nesta loja, com base em tendência, participação na rede e margem.</p>
              <MixTable
                rows={mixDisplayRows}
                opportunities={mixOpportunityRows}
                onSelect={(row) => setSelectedMixRow({ variant: "recomendacao", ...row })}
                onSelectOpportunity={(row) => setSelectedMixRow({ variant: "oportunidade", ...row })}
              />
              <MixDrawer row={selectedMixRow} open={selectedMixRow !== null} onOpenChange={(open) => !open && setSelectedMixRow(null)} />
            </RequestState>
          )}
        </TabsContent>

        <TabsContent value="saldo">
          <BalanceQualityTab storeName={storeName} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
