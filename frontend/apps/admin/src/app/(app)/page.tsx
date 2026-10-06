"use client";

import Link from "next/link";
import { useState } from "react";

import { CapexCard } from "@/components/overview/capex-card";
import { CashCard } from "@/components/overview/cash-card";
import { ExportPdfButton } from "@/components/overview/export-pdf-button";
import { HighlightsCard } from "@/components/overview/highlights-card";
import { InsightsCard } from "@/components/overview/insights-card";
import { KpiStrip } from "@/components/overview/kpi-strip";
import { LossCard } from "@/components/overview/loss-card";
import { PriceChangesCard } from "@/components/overview/price-changes-card";
import { ProductsCard } from "@/components/overview/products-card";
import { ReadingCard } from "@/components/overview/reading-card";
import { SkuLinksCard } from "@/components/overview/sku-links-card";
import { StoresCard } from "@/components/overview/stores-card";
import { TestsCard } from "@/components/overview/tests-card";
import { UsesCard } from "@/components/overview/uses-card";
import { WatchlistCard } from "@/components/overview/watchlist-card";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { date, period as fmtPeriod } from "@/lib/format";
import { monthName } from "@/lib/overview/reading";
import { useClosedPeriods, useMonthlyOverview } from "@/lib/overview/use-monthly-overview";

/**
 * Resumo executivo mensal da rede. Trabalha só com meses FECHADOS (DRE da
 * rede com status closed no accounting-service); cada bloco falha sozinho e
 * mostra "Indisponível" — nunca um zero. Todo número e insight vem de
 * `lib/overview` (motor puro e testado), o mesmo objeto que o PDF renderiza.
 */
export default function OverviewPage() {
  const closed = useClosedPeriods();
  const [selected, setSelected] = useState<string | null>(null);
  const period = selected ?? closed.periods[0] ?? null;
  const { overview, unavailable, isLoading, productsLoading, supplyLoading, financeLoading, refetch } = useMonthlyOverview(period);
  // Instante em que a tela carregou os dados — não é o horário do fechamento.
  const [loadedAt] = useState(() => new Date());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Visão geral"
        description={period ? `Resumo da rede — competência ${monthName(period).replace(/^./, (c) => c.toUpperCase())}` : "Resumo da rede"}
        actions={
          <>
            <Select value={period ?? ""} onValueChange={setSelected} disabled={closed.periods.length === 0}>
              <SelectTrigger className="w-40" aria-label="Competência">
                <SelectValue placeholder="Competência" />
              </SelectTrigger>
              <SelectContent>
                {closed.periods.map((p) => (
                  <SelectItem key={p} value={p}>{fmtPeriod(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ExportPdfButton overview={overview} loading={productsLoading || supplyLoading || financeLoading} />
          </>
        }
      />

      <RequestState
        isLoading={closed.isLoading || (period !== null && isLoading)}
        error={closed.isError ? ({ status: "FETCH_ERROR", error: "accounting" } as const) : undefined}
        onRetry={refetch}
        isEmpty={!closed.isLoading && closed.periods.length === 0}
        emptyMessage="Nenhum mês fechado ainda. Feche um mês em DRE (“Fechar o mês”) para ver o resumo."
      >
        {overview && period && (
          <>
            <p className="-mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Último fechamento do mês: {date(overview.closedAt)}</span>
              <span>Dados carregados em: {loadedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              <span>Comparações: vs. mês anterior e vs. média dos 3 meses anteriores</span>
              {!overview.previousClosed && (
                <span className="text-warning">{fmtPeriod(overview.previousPeriod)} ainda não está fechado no DRE — a comparação com o mês anterior é provisória.</span>
              )}
              <Link href={`/finance/pnl?period=${period}`} className="text-primary hover:underline">Ver DRE do mês →</Link>
            </p>

            {[overview.salesCoverage.current, overview.salesCoverage.previous].map(
              (c) =>
                c &&
                c.suspects.length > 0 && (
                  <p key={c.period} className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    As vendas de {fmtPeriod(c.period)} parecem incompletas em {c.suspects.length} de {c.checked} lojas
                    ({c.suspects.slice(0, 5).map((x) => `${x.name}: ${x.skus} SKUs vs. ~${x.typicalSkus} normais`).join("; ")}
                    {c.suspects.length > 5 ? "…" : ""}). Faturamento, margem e o DRE de {fmtPeriod(c.period)} podem estar abaixo do real — reimporte as vendas do mês em Importação antes de fechar o DRE.
                  </p>
                ),
            )}

            <KpiStrip
              kpis={overview.kpis}
              previousPeriod={overview.previousPeriod}
              unavailable={{ revenue: unavailable.pnl, contribution: unavailable.pnl, operating: unavailable.pnl, operatingMargin: unavailable.pnl, loss: unavailable.finance, cash: unavailable.treasury }}
            />

            <HighlightsCard highlights={overview.highlights} />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
              <div className="xl:col-span-3"><InsightsCard insights={overview.insights} /></div>
              <div className="xl:col-span-2"><StoresCard stores={overview.stores} unavailable={unavailable.stores} /></div>
            </div>

            <ProductsCard products={overview.products} loading={productsLoading} previousPeriod={overview.previousPeriod} unavailable={unavailable.sales} />

            <PriceChangesCard changes={overview.priceChanges} />

            <TestsCard tests={overview.tests} loading={supplyLoading} unavailable={unavailable.supply} networkStores={overview.stores?.activeCount ?? null} />

            <SkuLinksCard suggestions={overview.skuSuggestions} />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <LossCard loss={overview.loss} previousPeriod={overview.previousPeriod} />
              <CashCard cash={overview.cash} />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <UsesCard uses={overview.cashUses} previousPeriod={overview.previousPeriod} unavailable={unavailable.treasury} />
              <CapexCard capex={overview.capex} investors={overview.investors} previousPeriod={overview.previousPeriod} />
            </div>

            <ReadingCard reading={overview.reading} limitations={overview.limitations} />

            <WatchlistCard items={overview.watchlist} />
          </>
        )}
      </RequestState>
    </div>
  );
}
