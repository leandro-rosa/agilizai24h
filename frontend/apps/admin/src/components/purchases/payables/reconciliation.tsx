import { AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Payables } from "@/lib/api/purchases";
import { formatCents } from "@/lib/purchases/money";

interface Alert {
  text: string;
  ids: number[];
}

/** O que está fora de compasso entre pedido, nota, recebimento e pagamento. Cada aviso recorta a tabela nos pedidos em causa. */
export function Reconciliation({ data, onShow }: { data: Payables["reconciliation"]; onShow: (ids: number[], label: string) => void }) {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const alerts: Alert[] = [];
  const received = data.received_without_payment;
  if (received.count > 0) alerts.push({ text: `${received.count} ${plural(received.count, "nota recebida ainda não tem", "notas recebidas ainda não têm")} pagamento registrado (${formatCents(received.cents)}).`, ids: received.purchase_ids });
  const noInvoice = data.paid_without_invoice;
  if (noInvoice.count > 0) alerts.push({ text: `${noInvoice.count} ${plural(noInvoice.count, "pagamento registrado sem", "pagamentos registrados sem")} NF vinculada.`, ids: noInvoice.purchase_ids });
  const waiting = data.awaiting_receipt;
  if (waiting.count > 0) alerts.push({ text: `${waiting.count} ${plural(waiting.count, "pedido aguarda", "pedidos aguardam")} recebimento.`, ids: waiting.purchase_ids });
  const invoicing = data.awaiting_invoice;
  if (invoicing.count > 0) alerts.push({ text: `${invoicing.count} ${plural(invoicing.count, "pedido aguarda", "pedidos aguardam")} faturamento.`, ids: invoicing.purchase_ids });

  const steps = [
    { label: "Pedidos", value: data.funnel.orders },
    { label: "NF", value: data.funnel.invoiced },
    { label: "Recebimento", value: data.funnel.received },
    { label: "Pagamento", value: data.funnel.paid },
  ];

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">Conciliação</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Pedidos, nota fiscal, recebimento e pagamento">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden className="text-muted-foreground">→</span>}
              <span>
                {step.label} <strong className="tabular">{step.value}</strong>
              </span>
            </li>
          ))}
        </ol>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tudo em dia: nenhum pedido fora de compasso.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {alerts.map((alert) => (
              <li key={alert.text}>
                <button type="button" className="flex items-start gap-2 text-left text-sm hover:underline" onClick={() => onShow(alert.ids, alert.text)}>
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  {alert.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
