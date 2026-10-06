import { Card, CardContent } from "@/components/ui/card";
import type { Payables } from "@/lib/api/purchases";
import { formatCents } from "@/lib/purchases/money";
import { cn } from "@/lib/utils";

const plural = (n: number) => `${n} ${n === 1 ? "conta" : "contas"}`;

/** Os seis números do topo. "Na entrega" é o que se paga ao receber; "previsto no mês" é o aberto mais o já pago. */
export function SummaryCards({ summary }: { summary: Payables["summary"] }) {
  const cards = [
    { label: "Total em aberto", value: summary.open_cents, note: plural(summary.open_orders) },
    { label: "Vencidos", value: summary.overdue_cents, note: plural(summary.overdue_orders), tone: summary.overdue_cents > 0 ? "critical" : undefined },
    { label: "Vence em 7 dias", value: summary.due_7d_cents, note: plural(summary.due_7d_orders) },
    { label: "Pagar na entrega", value: summary.on_delivery_cents, note: plural(summary.on_delivery_orders) },
    { label: "Pago no mês", value: summary.paid_month_cents, note: plural(summary.paid_month_orders), tone: "positive" },
    { label: "Total previsto no mês", value: summary.forecast_month_cents, note: "Aberto + Pago" },
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" data-testid="payables-summary">
      {cards.map((card) => (
        <Card key={card.label} size="sm">
          <CardContent className="flex flex-col gap-1 pt-3">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className={cn("tabular text-2xl font-semibold", "tone" in card && card.tone === "critical" && "text-destructive", "tone" in card && card.tone === "positive" && "text-success")}>{formatCents(card.value)}</p>
            <p className="text-xs text-muted-foreground">{card.note}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
