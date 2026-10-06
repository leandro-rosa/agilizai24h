import type { Figure, Movement, SituationLabel, UnavailableReason } from "@/lib/api/supplier-analysis";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export type FigureKind = "units" | "cents" | "share" | "skus" | "ratio";

/** Por que uma cifra não existe, na linguagem do operador. Nunca "0". */
export const REASON_TEXT: Record<UnavailableReason, string> = {
  no_purchase_history: "Sem histórico de compras",
  never_ingested: "Dado não importado",
  no_cost: "Sem custo cadastrado",
  no_base: "—",
};

export function formatMonth(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1]}/${year}`;
}

export function formatValue(value: number, kind: FigureKind): string {
  if (kind === "cents") return brl.format(value / 100);
  if (kind === "share") return `${(value * 100).toFixed(1).replace(".", ",")}%`;
  if (kind === "ratio") return value.toFixed(2).replace(".", ",");
  if (kind === "skus") return `${integer.format(value)} ${value === 1 ? "SKU" : "SKUs"}`;
  return `${integer.format(value)} un.`;
}

/** Texto de uma cifra: o valor (com ~ quando parcial) ou o motivo da ausência. */
export function formatFigure(figure: Figure, kind: FigureKind): string {
  if (!figure.available) return REASON_TEXT[figure.reason];
  return `${figure.partial ? "~" : ""}${formatValue(figure.value, kind)}`;
}

/** Variação relativa, com sinal. `null` quando não há como comparar. */
export function formatChange(change: Figure): string | null {
  if (!change.available) return null;
  const pct = Math.round(change.value * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * Tom de uma variação. `higherIsBetter` é a leitura do negócio: vender mais é
 * bom; perder mais ou custar mais, não. Dentro da faixa "estável" não há tom.
 */
export function changeTone(change: Figure, higherIsBetter: boolean | null, stable = 0.05): "positive" | "critical" | "neutral" {
  if (!change.available || higherIsBetter === null || Math.abs(change.value) <= stable) return "neutral";
  return change.value > 0 === higherIsBetter ? "positive" : "critical";
}

export const SITUATION_TEXT: Record<SituationLabel, string> = { good: "Bom", attention: "Atenção", critical: "Crítico" };
export const SITUATION_TONE: Record<SituationLabel, "positive" | "attention" | "critical"> = {
  good: "positive",
  attention: "attention",
  critical: "critical",
};

/** Em quantos por cento do comprado (ou, sem compra, do abastecido) cada etapa cai. */
export function funnelShares(
  purchased: Figure,
  restocked: Figure,
  sold: Figure,
  lost: Figure,
): { base: "purchased" | "restocked"; steps: { key: "purchased" | "restocked" | "sold" | "lost"; value: number; share: number }[] } | null {
  const values = { purchased, restocked, sold, lost };
  const base = purchased.available && purchased.value > 0 ? "purchased" : "restocked";
  const reference = values[base];
  if (!reference.available || reference.value <= 0) return null;

  const steps = (["purchased", "restocked", "sold", "lost"] as const)
    .filter((key) => values[key].available)
    .map((key) => ({ key, value: (values[key] as { value: number }).value, share: (values[key] as { value: number }).value / reference.value }));

  return { base, steps };
}

/**
 * Um produto "parado" no mês: nada comprado, abastecido, vendido nem perdido.
 * Cifra indisponível não conta como movimento (ausência de dado não é atividade), e
 * zero real também não.
 */
export function hasMovement(movement: Movement): boolean {
  return [movement.purchasedUnits, movement.restocked, movement.sold, movement.lost].some((figure) => figure.available && figure.value > 0);
}
