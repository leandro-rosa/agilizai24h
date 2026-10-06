import type { PayableForm, PayableState } from "@/lib/api/purchases";
import type { StatusTone } from "@/components/status-badge";

export const FORM_LABEL: Record<NonNullable<PayableForm>, string> = { on_delivery: "Na entrega", boleto: "Boleto", transfer: "Transferência", other: "Outra" };
export const formLabel = (form: PayableForm): string => (form ? FORM_LABEL[form] : "Não informada");

export const STATE_LABEL: Record<PayableState, string> = { overdue: "Vencido", upcoming: "A vencer", on_delivery: "Na entrega", undated: "Sem data", paid: "Pago" };
export const STATE_TONE: Record<PayableState, StatusTone> = { overdue: "critical", upcoming: "neutral", on_delivery: "attention", undated: "neutral", paid: "positive" };

/** `2026-10` → "Out/2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const name = new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");

  return `${name.charAt(0).toUpperCase()}${name.slice(1)}/${year}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);

  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}
