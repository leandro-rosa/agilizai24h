"use client";

import { Landmark, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { useGetLatestPricingReportQuery, useStartPricingRunMutation } from "@/lib/api/pricing";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useHasPermission } from "@/lib/auth/use-permission";
import { date, period as formatPeriod } from "@/lib/format";
import { lastCompleteMonth } from "@/lib/period-range";
import { buildExportModel } from "@/lib/pricing/export-model";
import { applyFilters, costChanges, filterOptions, MARGIN_BAND_LABEL, NO_FILTERS, paginate, sortProducts, topOpportunities, type Filters, type SortKey } from "@/lib/pricing/view";
import { STATUS_LABEL } from "@/lib/pricing/labels";

import { ExportButtons } from "./export-buttons";
import { FiltersBar } from "./filters-bar";
import { ProductDrawer } from "./product-drawer";
import { ProductsTable } from "./products-table";
import { RulesDialog } from "./rules-dialog";
import { ScopeBar } from "./scope-bar";
import { setupNotes, SetupBanner } from "./setup-banner";
import { CategoriesSection, CostChangesSection, OpportunitiesSection } from "./support-sections";
import { SummaryCards } from "./summary-cards";

const POLL_MS = 3000;

/** Uma frase com os filtros ativos, para o Excel e o PDF dizerem de que recorte são. */
function describeFilters(filters: Filters, options: ReturnType<typeof filterOptions>): string {
  const parts: string[] = [];
  if (filters.category !== null) parts.push(`categoria ${options.categories.find((c) => c.key === filters.category)?.label ?? filters.category}`);
  if (filters.supplierId !== null) parts.push(`fornecedor ${options.suppliers.find((s) => s.id === filters.supplierId)?.name ?? filters.supplierId}`);
  if (filters.query.trim()) parts.push(`busca "${filters.query.trim()}"`);
  if (filters.status !== null) parts.push(`situação ${STATUS_LABEL[filters.status]}`);
  if (filters.marginBand !== null) parts.push(`margem ${MARGIN_BAND_LABEL[filters.marginBand].toLowerCase()}`);
  if (filters.belowTarget) parts.push("abaixo da meta");
  if (filters.costChanged) parts.push("com alteração de custo");

  return parts.length === 0 ? "nenhum" : parts.join("; ");
}

export function PricingScreen() {
  const [period, setPeriod] = useState(lastCompleteMonth());
  const [storeId, setStoreId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>("impact");
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: "", page: 1 });
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const canWrite = useHasPermission("products:write");
  const scope = { period, storeId };
  const { data: latest, isLoading, isFetching, error, refetch } = useGetLatestPricingReportQuery(scope);
  const [startRun, { isLoading: starting }] = useStartPricingRunMutation();
  const { data: stores } = useGetStoresQuery();

  // Enquanto há um cálculo em andamento, a tela pergunta de novo a cada poucos segundos; ao terminar, o timer se desfaz sozinho.
  const inProgress = Boolean(latest?.inProgress);
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => void refetch(), POLL_MS);

    return () => clearInterval(timer);
  }, [inProgress, refetch]);

  // A página recomeça na primeira quando o recorte muda; derivada do recorte, sem efeito.
  const pageKey = JSON.stringify([period, storeId, filters, sort, pageSize]);
  const page = pageState.key === pageKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ key: pageKey, page: next });

  const report = latest?.report ?? null;
  const products = useMemo(() => report?.products ?? [], [report]);
  const options = useMemo(() => filterOptions(products), [products]);
  const filtered = useMemo(() => sortProducts(applyFilters(products, filters), sort), [products, filters, sort]);
  const paged = paginate(filtered, page, pageSize);
  const opportunities = useMemo(() => topOpportunities(filtered), [filtered]);
  const changes = useMemo(() => costChanges(filtered), [filtered]);
  const categories = useMemo(() => (report?.categories ?? []).filter((row) => filters.category === null || row.categoryKey === filters.category), [report, filters.category]);
  const selectedProduct = useMemo(() => products.find((product) => product.sku === selected) ?? null, [products, selected]);
  const scopeLabel = storeId === null ? "Todas as lojas" : (stores?.find((store) => store.id === storeId)?.name ?? `Loja ${storeId}`);
  const notes = latest ? setupNotes(latest) : [];

  const exportModel = useMemo(
    () => (latest ? buildExportModel({ latest, products: filtered, scopeLabel, filtersLabel: describeFilters(filters, options), categories }) : null),
    [latest, filtered, scopeLabel, filters, options, categories],
  );

  async function recalculate() {
    try {
      const result = await startRun(scope).unwrap();
      toast.message(result.started ? "Cálculo iniciado. A tela atualiza sozinha quando terminar." : "Já existe um cálculo em andamento para este período.");
    } catch {
      toast.error("Não foi possível iniciar o cálculo.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Precificação Inteligente"
        description="A IA analisa custos, vendas, perdas e estrutura financeira para sugerir preços mais saudáveis para cada produto."
        actions={
          <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center">
            <ScopeBar period={period} onPeriodChange={setPeriod} storeId={storeId} onStoreIdChange={setStoreId} />
            <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>
              <Landmark aria-hidden />
              Regras de negócio
            </Button>
            <ExportButtons model={exportModel} unavailableReason="Aguarde o relatório carregar: não há nada para exportar ainda." />
          </div>
        }
      />

      <RequestState isLoading={isLoading} error={error} onRetry={refetch}>
        {latest && (
          <>
            {inProgress && (
              <p role="status" className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                <RefreshCw aria-hidden className="size-4 animate-spin" />
                Calculando o relatório de {formatPeriod(period)}…
              </p>
            )}

            {latest.lastFailure && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/12 p-3 text-sm text-destructive">
                O último cálculo falhou: {latest.lastFailure.error ?? "motivo não informado"}. {latest.state === "ready" ? "Os números abaixo são do cálculo anterior." : ""}
              </p>
            )}

            {latest.state === "none" ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
                <p className="font-medium">Ainda não há relatório calculado para este período{storeId === null ? "" : " e esta loja"}.</p>
                <p className="text-sm text-muted-foreground">Calcular lê custos, vendas, perdas, taxas e DRE e guarda o resultado; o cálculo roda em segundo plano.</p>
                <Button onClick={recalculate} disabled={starting || inProgress}>
                  {starting || inProgress ? "Calculando…" : "Calcular relatório"}
                </Button>
              </div>
            ) : (
              report && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Calculado em {date(latest.run?.computedAt)} · motor {latest.run?.engineVersion} · regras v{latest.run?.parameterVersion}
                      {latest.parametersStale && <strong className="ml-2 text-warning">As regras mudaram depois deste cálculo: recalcule para valerem.</strong>}
                    </span>
                    <Button variant="outline" size="sm" onClick={recalculate} disabled={starting || inProgress || isFetching}>
                      <RefreshCw aria-hidden />
                      Recalcular
                    </Button>
                  </div>

                  <SetupBanner notes={notes} onOpenRules={() => setRulesOpen(true)} />
                  <SummaryCards summary={report.summary} />

                  <FiltersBar filters={filters} onChange={setFilters} sort={sort} onSortChange={setSort} categories={options.categories} suppliers={options.suppliers} />

                  <RequestState isLoading={false} isEmpty={filtered.length === 0} emptyMessage="Nenhum produto com esses filtros.">
                    <ProductsTable rows={paged.rows} total={filtered.length} page={paged.page} pages={paged.pages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} onOpen={setSelected} />
                  </RequestState>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <OpportunitiesSection items={opportunities} onOpen={setSelected} />
                    <CostChangesSection items={changes} onOpen={setSelected} />
                    <CategoriesSection items={categories} />
                  </div>
                </>
              )
            )}
          </>
        )}
      </RequestState>

      <ProductDrawer
        product={selectedProduct}
        scope={scope}
        run={latest?.run ?? null}
        canWrite={canWrite}
        onClose={() => setSelected(null)}
        onApplied={() => {
          // O preço mudou: o relatório guardado ficou velho. Recalcula e a tela segue o andamento sozinha.
          void startRun(scope);
        }}
      />

      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} categories={options.categories} canEdit={canWrite} />
    </div>
  );
}
