import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import type { Payables } from "@/lib/api/purchases";
import { formatCents } from "@/lib/purchases/money";
import { formLabel } from "./labels";

const dayParts = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);

  return { number: String(date.getUTCDate()).padStart(2, "0"), month: date.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "").toUpperCase() };
};

/** Próximos pagamentos (a agenda) e os compromissos no caixa. Entrega prevista é ESTIMATIVA e fica marcada. */
export function Agenda({ payables, onSeeAll }: { payables: Payables; onSeeAll: () => void }) {
  const { upcoming, commitments } = payables;

  return (
    <>
      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm">Próximos pagamentos</CardTitle>
          <button type="button" className="text-xs text-primary hover:underline" onClick={onSeeAll}>
            Ver todos
          </button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nada com data a pagar.</p>}
          {upcoming.map((order) => {
            const parts = order.due_on ? dayParts(order.due_on) : null;
            return (
              <div key={order.purchase_id} className="flex items-center gap-3 text-sm" data-testid="upcoming-row">
                {parts && (
                  <div className="flex w-10 shrink-0 flex-col items-center rounded-md bg-muted px-1 py-0.5 text-center leading-tight">
                    <span className="font-semibold">{parts.number}</span>
                    <span className="text-[10px] text-muted-foreground">{parts.month}</span>
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate">
                  {order.supplier_name ?? `Fornecedor ${order.supplier_id}`}
                  {order.estimated && <span className="text-xs text-muted-foreground"> (previsto)</span>}
                </span>
                <span className="tabular">{formatCents(order.open_cents)}</span>
                <StatusBadge tone={order.state === "on_delivery" ? "attention" : "neutral"}>{formLabel(order.form)}</StatusBadge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">Compromissos no caixa</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Row label="Próximos 7 dias" value={commitments.next_7_days_cents} />
          <Row label="Próximos 30 dias" value={commitments.next_30_days_cents} />
          <Row label="Pago no mês" value={commitments.paid_month_cents} />
          {commitments.next_7_days_cents > 0 && (
            <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs" role="status">
              {formatCents(commitments.next_7_days_cents)} em pagamentos previstos para os próximos 7 dias.
            </p>
          )}
          <p className="text-xs text-muted-foreground">Só itens pagos (consignado é do Acerto semanal). “Na entrega” entra na data de entrega prevista, quando houver.</p>
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between border-b py-1 last:border-0">
      <span>{label}</span>
      <span className="tabular font-medium">{formatCents(value)}</span>
    </div>
  );
}
