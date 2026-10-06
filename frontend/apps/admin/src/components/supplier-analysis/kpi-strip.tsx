import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompareTo, Figure, Variation } from "@/lib/api/supplier-analysis";
import { changeTone, formatChange, formatFigure, type FigureKind } from "@/lib/supplier-analysis/format";
import { cn } from "@/lib/utils";

export interface Kpi {
  label: string;
  figure: Figure;
  kind: FigureKind;
  variation: Variation;
  /** `true` quando mais é melhor (vendas), `false` quando menos é melhor (perda), `null` quando não há leitura. */
  higherIsBetter: boolean | null;
  /** Segunda linha de valor, p.ex. a perda em R$ ao lado das unidades. */
  secondary?: { figure: Figure; kind: FigureKind };
}

const TONE_CLASS = { positive: "text-success", critical: "text-destructive", neutral: "text-muted-foreground" } as const;
const REFERENCE_LABEL: Record<CompareTo, string> = { prev_month: "mês anterior", avg_3m: "média de 3 meses" };

/** Faixa de indicadores com a variação contra a comparação escolhida e o valor de referência à vista. */
export function KpiStrip({ items, compareTo, columns = 6 }: { items: Kpi[]; compareTo: CompareTo; columns?: 4 | 6 }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", columns === 6 ? "xl:grid-cols-6" : "xl:grid-cols-4")} data-testid="kpi-strip">
      {items.map((kpi) => {
        const change = formatChange(kpi.variation.change);
        const tone = changeTone(kpi.variation.change, kpi.higherIsBetter);

        return (
          <Card key={kpi.label} size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">{kpi.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <p className={cn("tabular text-2xl font-semibold", !kpi.figure.available && "text-base font-normal text-muted-foreground")}>
                {formatFigure(kpi.figure, kpi.kind)}
              </p>
              {kpi.secondary && kpi.secondary.figure.available && (
                <p className="tabular text-xs text-muted-foreground">{formatFigure(kpi.secondary.figure, kpi.secondary.kind)}</p>
              )}
              {change ? (
                <p className={cn("tabular text-xs", TONE_CLASS[tone])}>
                  {change} <span className="text-muted-foreground">vs. {REFERENCE_LABEL[compareTo]}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Sem comparação</p>
              )}
              {kpi.variation.reference.available && (
                <p className="tabular text-xs text-muted-foreground">
                  {REFERENCE_LABEL[compareTo]}: {formatFigure(kpi.variation.reference, kpi.kind)}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
