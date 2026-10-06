import { signedPct } from "./compare";
import type { ValueDelta } from "./compare";
import { period as fmtPeriod } from "../format";
import type { Insight, KpiResult, Overview } from "./types";

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthName = (p: string) => `${MONTH_NAMES[Number(p.split("-")[1]) - 1]}/${p.split("-")[0]}`;

const k = (kpis: KpiResult[], key: KpiResult["key"]) => kpis.find((x) => x.key === key);
const d = (x?: KpiResult) => (x?.vsPrevious as ValueDelta | undefined)?.pct ?? null;

/**
 * Parágrafo montado só de números já calculados, em frases curtas. Cada
 * frase é omitida quando falta o dado — nada de causa inventada, nada de
 * adjetivo ("bom", "forte").
 */
export function buildReading(args: Pick<Overview, "period" | "previousPeriod" | "kpis" | "stores" | "products" | "cashUses" | "cash"> & { insights: Insight[] }): string {
  const parts: string[] = [];
  const rev = d(k(args.kpis, "revenue"));
  const loss = d(k(args.kpis, "loss"));
  const op = d(k(args.kpis, "operating"));
  const prev = fmtPeriod(args.previousPeriod);

  if (rev !== null) parts.push(`${monthName(args.period)} fechou com faturamento ${signedPct(rev)} vs. ${prev}${loss !== null ? ` e perdas ${signedPct(loss)}` : ""}.`);
  else if (loss !== null) parts.push(`${monthName(args.period)} fechou com perdas ${signedPct(loss)} vs. ${prev}.`);
  if (op !== null) parts.push(`O resultado operacional variou ${signedPct(op)}.`);

  if (args.cash.operatingPositiveCashFell) {
    const drivers = [args.cashUses?.stock?.material ? "compras de estoque" : null, args.cashUses?.capex?.material ? "CAPEX" : null].filter(Boolean);
    parts.push(`O caixa caiu apesar do resultado operacional positivo${drivers.length ? `; houve variação material em ${drivers.join(" e ")}` : ""}.`);
  }

  if (args.stores?.topGrowth.length) {
    const share = args.stores.topGrowth.length;
    parts.push(`O crescimento de receita teve maior contribuição de ${share} ${share === 1 ? "loja" : "lojas"} (${args.stores.topGrowth.map((s) => s.name).join(", ")}).`);
  }
  const falling = args.products?.falling.filter((p) => p.behavior === "queda_consistente") ?? [];
  if (falling.length) parts.push(`${falling.length} ${falling.length === 1 ? "produto relevante apresenta" : "produtos relevantes apresentam"} queda consistente nos últimos 4 meses.`);

  return parts.join(" ");
}
