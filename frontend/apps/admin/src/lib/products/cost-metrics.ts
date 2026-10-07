import type { CostVersionView } from "@/lib/api/products";

/*
 * Os números de custo de um produto, sempre com origem e data. NUNCA um "custo" solto: a tela mostra cinco coisas diferentes e cada uma diz o que é.
 * Aqui só se LÊ a série que o products-service guarda; o custo vigente numa data é a mesma regra dele (a versão mais recente com vigência até a data;
 * na mesma data, a de nota prevalece sobre a manual, e entre iguais a última registrada).
 */

const RANK: Record<string, number> = { invoice: 0, manual: 1 };
const rankOf = (source: string) => RANK[source] ?? 2;
const dayOf = (value: string) => value.slice(0, 10);

/** O custo em vigor num dia (`YYYY-MM-DD`), ou nulo antes da primeira versão — nunca cai para a mais antiga. */
export function costInForce(versions: CostVersionView[], asOf: string): CostVersionView | null {
  const eligible = versions.filter((v) => dayOf(v.effective_from) <= asOf);
  if (eligible.length === 0) return null;
  const latest = eligible.reduce((max, v) => (dayOf(v.effective_from) > max ? dayOf(v.effective_from) : max), "");
  const sameDay = eligible.filter((v) => dayOf(v.effective_from) === latest);

  return [...sameDay].sort((a, b) => rankOf(a.source) - rankOf(b.source) || b.id - a.id)[0];
}

export interface CostNumbers {
  /** O que vale hoje (e é o que a Precificação usa). */
  inForce: CostVersionView | null;
  /** A compra mais recente que gerou custo (origem nota fiscal). */
  lastPurchase: CostVersionView | null;
  /** Média ponderada pelas compras registradas: total pago ÷ unidades. MÉTRICA DERIVADA; só vale com compras que têm quantidade e total. */
  weightedPurchase: { centsPerUnit: number; units: number; purchases: number } | null;
  /** O custo que o CMV do mês usa: o vigente no último dia do mês (a regra do finance-service). */
  forCmv: { month: string; version: CostVersionView | null };
}

function lastDayOfMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);

  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

export function costNumbers(versions: CostVersionView[], today: string, cmvMonth: string): CostNumbers {
  const invoiceVersions = versions.filter((v) => v.source === "invoice" && !v.superseded);
  const lastPurchase = [...invoiceVersions].sort((a, b) => dayOf(b.effective_from).localeCompare(dayOf(a.effective_from)) || b.id - a.id)[0] ?? null;
  const measured = invoiceVersions.filter((v) => v.purchase_quantity && v.purchase_total_cents);
  const units = measured.reduce((sum, v) => sum + (v.purchase_quantity as number), 0);
  const total = measured.reduce((sum, v) => sum + (v.purchase_total_cents as number), 0);

  return {
    inForce: costInForce(versions, today),
    lastPurchase,
    weightedPurchase: units > 0 ? { centsPerUnit: Math.round(total / units), units, purchases: measured.length } : null,
    forCmv: { month: cmvMonth, version: costInForce(versions, lastDayOfMonth(cmvMonth)) },
  };
}

/** O mês completo mais recente (o último que já acabou), `YYYY-MM`. */
export function lastClosedMonth(today: string): string {
  const [year, month] = today.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));

  return previous.toISOString().slice(0, 7);
}
