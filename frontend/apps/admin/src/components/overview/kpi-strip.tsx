import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { period as fmtPeriod } from "@/lib/format";
import type { RateDelta, ValueDelta } from "@/lib/overview/compare";
import { KPI_PLAIN } from "@/lib/overview/plain";
import type { KpiResult } from "@/lib/overview/types";
import { Delta, moneyRound, NoData, pctText, Unavailable } from "./shared";

/** Cada KPI mostra valor, variação e a BASE (o valor do mês anterior), para o % nunca andar sozinho. */
export function KpiStrip({ kpis, previousPeriod, unavailable }: { kpis: KpiResult[]; previousPeriod: string; unavailable: Partial<Record<KpiResult["key"], boolean>> }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
      {kpis.map((k) => {
        const isRate = k.kind === "rate";
        const prev = isRate ? (k.vsPrevious as RateDelta).pp : (k.vsPrevious as ValueDelta).pct;
        const avg = isRate ? (k.vsAvg3 as RateDelta).pp : (k.vsAvg3 as ValueDelta).pct;
        const fmt = (v: number | null) => (isRate ? pctText(v) : moneyRound(v));
        return (
          <Card key={k.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground" title={`Termo técnico: ${KPI_PLAIN[k.key].technical}`}>{KPI_PLAIN[k.key].title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {unavailable[k.key] ? (
                <Unavailable what="erro ao buscar" />
              ) : k.value === null ? (
                <NoData />
              ) : (
                <>
                  <p className="tabular text-2xl font-semibold">{fmt(k.value)}</p>
                  <Delta value={prev} kind={isRate ? "pp" : "pct"} goodWhenUp={k.goodWhenUp} label={`vs. ${fmtPeriod(previousPeriod)}`} />
                  <p className="tabular text-xs text-muted-foreground">{k.previous === null ? "sem base no mês anterior" : `${fmtPeriod(previousPeriod)}: ${fmt(k.previous)}`}</p>
                  <Delta value={avg} kind={isRate ? "pp" : "pct"} goodWhenUp={k.goodWhenUp} label="vs. média 3 meses" />
                  <p className="text-[11px] leading-tight text-muted-foreground">{KPI_PLAIN[k.key].note}</p>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
