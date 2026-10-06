import type { Purchase, Stage } from "@/lib/api/purchases";

/** As cinco etapas do pedido, na ordem do quadro. */
export const STAGES: Stage[] = ["requisition", "awaiting_invoice", "invoiced", "awaiting_receipt", "received"];

export const STAGE_LABEL: Record<Stage, string> = {
  requisition: "Requisição de compra",
  awaiting_invoice: "Aguardando faturamento",
  invoiced: "Faturado",
  awaiting_receipt: "Aguardando recebimento",
  received: "Recebido",
};

export function nextStage(stage: Stage): Stage | null {
  return STAGES[STAGES.indexOf(stage) + 1] ?? null;
}

/** O que o botão do cartão faz em cada etapa (nenhum em "Recebido": é definitivo). */
export const NEXT_ACTION: Record<Stage, string | null> = {
  requisition: "Enviar ao fornecedor",
  awaiting_invoice: "Faturar",
  invoiced: "Aguardar recebimento",
  awaiting_receipt: "Receber",
  received: null,
};

/** Os pedidos de cada coluna, mais recentes primeiro; nenhuma coluna fica de fora, mesmo vazia. */
export function groupByStage(purchases: Purchase[]): Record<Stage, Purchase[]> {
  const columns = Object.fromEntries(STAGES.map((stage) => [stage, [] as Purchase[]])) as Record<Stage, Purchase[]>;
  for (const purchase of purchases) columns[purchase.status].push(purchase);
  for (const stage of STAGES) columns[stage].sort((a, b) => b.ordered_on.localeCompare(a.ordered_on) || b.id - a.id);

  return columns;
}

/** Valor total do pedido (pago + consignado + bonificação ao custo de referência), para o cartão. */
export const orderTotalCents = (purchase: Purchase): number => purchase.items.reduce((sum, item) => sum + item.total_cents, 0);

/** Aviso do cartão: entrega atrasada e/ou pagamento vencido. */
export function orderAlerts(purchase: Purchase): string[] {
  return [purchase.late ? "Entrega atrasada" : null, purchase.overdue ? "Pagamento vencido" : null].filter((alert): alert is string => alert !== null);
}
