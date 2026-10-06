import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Movement } from "@/lib/api/supplier-analysis";
import { formatValue, funnelShares } from "@/lib/supplier-analysis/format";

const LABEL = { purchased: "Comprado", restocked: "Abastecido", sold: "Vendido", lost: "Perdido" } as const;
const COLOR = { purchased: "var(--chart-1)", restocked: "var(--chart-2)", sold: "var(--chart-3)", lost: "var(--destructive)" } as const;

/** Do comprado ao perdido, em % da base. Sem compra registrada, a base é o abastecido — e a tela diz isso. */
export function MovementBars({ movement }: { movement: Movement }) {
  const funnel = funnelShares(movement.purchasedUnits, movement.restocked, movement.sold, movement.lost);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Movimentação no período</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!funnel && <p className="text-sm text-muted-foreground">Sem abastecimento no período para montar a movimentação.</p>}
        {funnel?.steps.map((step) => (
          <div key={step.key} className="grid grid-cols-[6rem_5rem_1fr_3rem] items-center gap-2 text-sm">
            <span>{LABEL[step.key]}</span>
            <span className="tabular text-right">{formatValue(step.value, "units")}</span>
            <div className="h-2 rounded-full bg-secondary">
              <div className="h-2 rounded-full" style={{ width: `${Math.min(100, Math.round(step.share * 100))}%`, background: COLOR[step.key] }} />
            </div>
            <span className="tabular text-right text-xs text-muted-foreground">{Math.round(step.share * 100)}%</span>
          </div>
        ))}
        {funnel?.base === "restocked" && (
          <p className="text-xs text-muted-foreground">Sem histórico de compras: percentuais sobre o abastecido.</p>
        )}
      </CardContent>
    </Card>
  );
}
