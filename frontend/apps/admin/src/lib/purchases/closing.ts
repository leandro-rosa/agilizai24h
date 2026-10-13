import type { ClosingExtraPick, ClosingIssue, ClosingPreview, RemovalKind, RemovalLine } from "@/lib/api/purchases";

import { addDays, formatDate } from "./money";

export type Verdict = { tone: "positive" | "neutral" | "attention" | "critical"; title: string; text: string };

/** O que a consulta respondeu, em palavras: valor zero nunca vale por "sem vendas", "configuração pendente", "incompleto" ou "erro". */
export function verdictOf(preview: ClosingPreview): Verdict {
  switch (preview.status) {
    case "ready":
      return { tone: "positive", title: "Fechamento calculado", text: "Confira os produtos e confirme. Consultar não gera dívida: só a confirmação gera." };
    case "no_sales":
      return { tone: "neutral", title: "Sem vendas no período", text: `Nenhum produto de ${preview.supplier_name} vendeu entre ${formatDate(preview.period_from)} e ${formatDate(preview.period_to)}. Não há valor a repassar.` };
    case "incomplete":
      return { tone: "attention", title: "Dados incompletos", text: "O valor abaixo pode estar errado. Veja o que falta antes de confirmar." };
    case "config_pending":
      return { tone: "attention", title: "Configuração pendente", text: `${preview.supplier_name} ainda não tem produtos consignados com custo de repasse.` };
    case "conflict": {
      const hit = preview.conflict;
      return {
        tone: "critical",
        title: "Período já fechado",
        text: hit
          ? `Este período tem dias do fechamento de ${formatDate(hit.period_from)} a ${formatDate(hit.period_to)} (${hit.state === "paid" ? "pago" : "confirmado"}). Um dia não pode ser repassado duas vezes.`
          : "Este período tem dias de um fechamento já confirmado.",
      };
    }
  }
}

/** `2026-10` → `10/2026`. */
const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

export function issueText(issue: ClosingIssue): string {
  switch (issue.code) {
    case "cost_changes_in_period":
      return `O custo de ${issue.sku} começa ou muda em ${formatDate(issue.detail ?? null)}, dentro do período. Feche até o dia anterior e comece outro período a partir dessa data.`;
    case "sales_dates_missing":
      return `Não há vendas com data importadas para ${(issue.detail ?? "").split(", ").map(monthLabel).join(", ")}: as unidades vendidas desse mês são desconhecidas. Importe as vendas do mês em Ingestão e consulte de novo.`;
    case "stores_missing":
      return `${issue.detail} loja(s) sem importação de vendas no período: o valor pode estar menor que o real.`;
  }
}

/** O período digitado começa antes do fim do último fechamento? Só avisa; quem corrige é a pessoa (nada é ajustado em silêncio). */
export function overlapsLast(last: { period_from: string; period_to: string } | null, from: string, to: string): boolean {
  return Boolean(last && from && to && from <= last.period_to && to >= last.period_from);
}

export function nextAfter(last: { period_to: string }): string {
  return addDays(last.period_to, 1);
}

export function rangeOfLength(from: string, days: number): { from: string; to: string } {
  return { from, to: addDays(from, days - 1) };
}

export const pickKey = (sku: string, month: string, kind: RemovalKind) => `${sku}|${month}|${kind}`;

/** O que a pessoa marcou, na forma que o servidor recebe. */
export function picksOf(keys: Set<string>): ClosingExtraPick[] {
  return [...keys].map((key) => {
    const [sku, month, kind] = key.split("|");
    return { sku, month, kind: kind as RemovalKind };
  });
}

/** Soma só o que foi marcado e tem valor (a conta que vale é a do servidor; esta só mostra o resultado enquanto a pessoa escolhe). */
export function pickedTotal(lines: RemovalLine[], keys: Set<string>): { units: number; cents: number } {
  let units = 0;
  let cents = 0;
  for (const line of lines)
    for (const kind of ["expired", "other_reason"] as const) {
      const cell = line[kind];
      if (keys.has(pickKey(line.sku, line.month, kind)) && cell.units > 0 && cell.cents !== null) {
        units += cell.units;
        cents += cell.cents;
      }
    }
  return { units, cents };
}
