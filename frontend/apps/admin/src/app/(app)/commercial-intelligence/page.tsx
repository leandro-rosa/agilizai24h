"use client";

import { useCallback, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MixDrawer, type MixDrawerRow } from "@/components/commercial-intelligence/mix/mix-drawer";
import { MixTable, type MixDisplayRow, type MixOpportunityRow } from "@/components/commercial-intelligence/mix/mix-table";
import { RestockDrawer } from "@/components/commercial-intelligence/restock/restock-drawer";
import { RestockPanel } from "@/components/commercial-intelligence/restock/restock-panel";
import { RestockTable, type RestockDisplayRow } from "@/components/commercial-intelligence/restock/restock-table";
import { useGetCostsAsOfQuery, useGetProductsQuery } from "@/lib/api/products";
import { useGetNetworkReconciliationRangeQuery } from "@/lib/api/finance";
import { useGetNetworkSalesByStoreMonthQuery } from "@/lib/api/sales";
import { useGetNetworkSupplyByStoreMonthQuery } from "@/lib/api/supply";
import { useGetStoresQuery } from "@/lib/api/stores";
import { computeMixOpportunities, computeMixRecommendations, type MixEngineInput } from "@/lib/commercial-intelligence/restock-mix/mix/engine";
import { RUNTIME_MIX_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/mix/parameters";
import { computeRestockRecommendations, type RestockEngineInput } from "@/lib/commercial-intelligence/restock-mix/restock/engine";
import { RUNTIME_RESTOCK_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/restock/parameters";
import { analyzeLossIntelligence } from "@/lib/loss-intelligence/engine";
import { RUNTIME_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import type { LossIntelligenceInput } from "@/lib/loss-intelligence/types";
import { addMonths, lastCompleteMonth, type PeriodRange } from "@/lib/period-range";

export default function CommercialIntelligencePage() {
  const { data: stores, error: storesError } = useGetStoresQuery();
  const { data: products, error: productsError } = useGetProductsQuery();
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  const scopedStores = useMemo(() => stores ?? [], [stores]);
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
    refetch,
  } = useGetNetworkReconciliationRangeQuery({ stores: scopedStores, range: engineRange }, { skip });
  const { data: salesByStoreMonth, isLoading: loadingSales, error: salesError } = useGetNetworkSalesByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });
  const { data: supplyByStoreMonth, isLoading: loadingSupply, error: supplyError } = useGetNetworkSupplyByStoreMonthQuery({ stores: scopedStores, range: engineRange }, { skip });

  const allSkusForCost = useMemo(() => [...new Set((salesByStoreMonth ?? []).flatMap((month) => month.bySku.map((row) => row.sku)))], [salesByStoreMonth]);
  const { data: costsResult } = useGetCostsAsOfQuery({ skus: allSkusForCost, asOf: `${engineAsOfPeriod}-01` }, { skip: allSkusForCost.length === 0 });
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
    if (!lossResult || !products || !salesByStoreMonth || !supplyByStoreMonth || !reconciliationByStoreMonth) return [];
    const input: RestockEngineInput = {
      stores: scopedStores, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, lossResult, today,
      lossParameters: RUNTIME_PARAMETERS.parameters, restockParameters: RUNTIME_RESTOCK_PARAMETERS.parameters,
    };
    return computeRestockRecommendations(input);
  }, [lossResult, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, scopedStores, today]);

  const mixEngineInput = useMemo<MixEngineInput | null>(() => {
    if (!lossResult || !products || !salesByStoreMonth || !supplyByStoreMonth || !reconciliationByStoreMonth || !costsBySkuAsOf) return null;
    return {
      stores: scopedStores, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, lossResult, today,
      lossParameters: RUNTIME_PARAMETERS.parameters, mixParameters: RUNTIME_MIX_PARAMETERS.parameters, costsBySkuAsOf,
    };
  }, [lossResult, products, salesByStoreMonth, supplyByStoreMonth, reconciliationByStoreMonth, costsBySkuAsOf, scopedStores, today]);

  const mixRecommendations = useMemo(() => (mixEngineInput ? computeMixRecommendations(mixEngineInput) : []), [mixEngineInput]);
  const mixOpportunities = useMemo(() => (mixEngineInput ? computeMixOpportunities(mixEngineInput) : []), [mixEngineInput]);

  const nameBySku = useMemo(() => new Map((products ?? []).map((p) => [p.sku, p.name])), [products]);
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

  const combinedError = error ?? storesError ?? productsError ?? salesError ?? supplyError;
  const isLoading = loadingReconciliation || loadingSales || loadingSupply;
  const isEmpty = !isLoading && !combinedError && selectedStoreId !== null && restockDisplayRows.length === 0 && mixDisplayRows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inteligência Comercial"
        description="A IA analisa vendas, abastecimentos, margem e perdas para sugerir o que levar para cada loja e quais produtos deveriam existir nela."
      />

      <Select value={selectedStoreId === null ? undefined : String(selectedStoreId)} onValueChange={(value) => setSelectedStoreId(Number(value))}>
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

      {selectedStoreId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja para ver as recomendações de abastecimento e mix.</p>
      ) : (
        <RequestState isLoading={isLoading} error={combinedError} isEmpty={isEmpty} emptyMessage="Sem dados suficientes nesta loja para calcular recomendações." onRetry={refetch}>
          <Tabs defaultValue="abastecimento" className="gap-6">
            <TabsList>
              <TabsTrigger value="abastecimento">Abastecimento Inteligente</TabsTrigger>
              <TabsTrigger value="mix">Mix das Lojas</TabsTrigger>
            </TabsList>

            <TabsContent value="abastecimento" className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">A IA analisa vendas, abastecimentos, margem e perdas para sugerir o que levar para cada loja.</p>
              <RestockPanel rows={restockDisplayRows} />
              <RestockTable rows={restockDisplayRows} onSelect={setSelectedRestockRow} />
              <RestockDrawer row={selectedRestockRow} open={selectedRestockRow !== null} onOpenChange={(open) => !open && setSelectedRestockRow(null)} />
            </TabsContent>

            <TabsContent value="mix" className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Quais produtos deveriam existir nesta loja, com base em tendência, participação na rede e margem.</p>
              <MixTable
                rows={mixDisplayRows}
                opportunities={mixOpportunityRows}
                onSelect={(row) => setSelectedMixRow({ variant: "recomendacao", ...row })}
                onSelectOpportunity={(row) => setSelectedMixRow({ variant: "oportunidade", ...row })}
              />
              <MixDrawer row={selectedMixRow} open={selectedMixRow !== null} onOpenChange={(open) => !open && setSelectedMixRow(null)} />
            </TabsContent>
          </Tabs>
        </RequestState>
      )}
    </div>
  );
}
