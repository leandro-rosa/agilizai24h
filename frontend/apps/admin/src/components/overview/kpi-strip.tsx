import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { period as fmtPeriod } from "@/lib/format";
import type { RateDelta, ValueDelta } from "@/lib/overview/compare";
import type { KpiResult } from "@/lib/overview/types";
import { Delta, moneyRound, pctText, Unavailable } from "./shared";

export function KpiStrip({ kpis, previousPeriod, unavailable }: { kpis: KpiResult[]; previousPeriod: string; unavailable: Partial<Record<KpiResult["key"], boolean>> }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
      {kpis.map((k) => {
        const isRate = k.kind === "rate";
        const prev = (isRate ? (k.vsPrevious as RateDelta).pp : (k.vsPrevious as ValueDelta).pct);
        const avg = (isRate ? (k.vsAvg3 as RateDelta).pp : (k.vsAvg3 as ValueDelta).pct);
        return (
          <Card key={k.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {k.value === null || unavailable[k.key] ? (
                <Unavailable />
              ) : (
                <>
                  <p className="tabular text-2xl font-semibold">{isRate ? pctText(k.value) : moneyRound(k.value)}</p>
                  <Delta value={prev} kind={isRate ? "pp" : "pct"} goodWhenUp={k.goodWhenUp} label={`vs. ${fmtPeriod(previousPeriod)}`} />
                  <Delta value={avg} kind={isRate ? "pp" : "pct"} goodWhenUp={k.goodWhenUp} label="vs. média 3 meses" />
                  <p className="text-[11px] leading-tight text-muted-foreground">{k.note}</p>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
