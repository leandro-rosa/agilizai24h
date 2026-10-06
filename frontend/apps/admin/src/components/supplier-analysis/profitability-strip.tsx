import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import type { CompareTo, Figure, MovementWithComparison } from "@/lib/api/supplier-analysis";
import { formatFigure } from "@/lib/supplier-analysis/format";
import { KpiStrip, type Kpi } from "./kpi-strip";

const NO_BASE = { reference: { available: false, reason: "no_base" }, change: { available: false, reason: "no_base" } } as const;

/**
 * Margem e markup do período, no molde do relatório de Margem e Markup do PDV: lucro bruto, margem média,
 * markup (preço ÷ custo), produtos com atenção (margem abaixo do corte) e a cobertura do custo — quanto da
 * receita tem custo cadastrado; abaixo de 100% a margem é parcial.
 */
export function ProfitabilityStrip({
  totals,
  compareTo,
  rangeMonths,
  attention,
}: {
  totals: MovementWithComparison;
  compareTo: CompareTo;
  rangeMonths: number;
  attention?: { threshold: number; count: number; rated: number };
}) {
  const { current, comparison } = totals;
  const kpis: Kpi[] = [
    { label: "Lucro bruto", figure: current.grossProfitCents, kind: "cents", variation: comparison.grossProfitCents, higherIsBetter: true },
    { label: "Margem média bruta", figure: current.marginShare, kind: "share", variation: comparison.marginShare, higherIsBetter: true },
    { label: "Markup médio", figure: current.markup, kind: "ratio", variation: comparison.markup, higherIsBetter: true, hint: "preço ÷ custo" },
    { label: "Preço médio de venda", figure: current.avgPriceCents, kind: "cents", variation: comparison.avgPriceCents, higherIsBetter: null },
  ];

  if (attention) {
    const share: Figure = attention.rated > 0 ? { available: true, value: attention.count / attention.rated } : { available: false, reason: "no_base" };
    kpis.splice(3, 0, {
      label: "Produtos com atenção",
      figure: { available: true, value: attention.count },
      kind: "skus",
      variation: NO_BASE,
      higherIsBetter: null,
      hint: `${formatFigure(share, "share")} dos ${attention.rated} avaliados · margem < ${Math.round(attention.threshold * 100)}%`,
    });
  }

  const coverage = current.costCoverage;
  const incomplete = coverage.available && coverage.value < 0.95;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Rentabilidade</CardTitle>
          <StatusBadge tone={incomplete ? "attention" : "neutral"}>Cobertura do custo: {formatFigure(coverage, "share")}</StatusBadge>
        </div>
      </CardHeader>
      <CardContent>
        <KpiStrip items={kpis} compareTo={compareTo} rangeMonths={rangeMonths} columns={attention ? 6 : 4} />
      </CardContent>
    </Card>
  );
}
