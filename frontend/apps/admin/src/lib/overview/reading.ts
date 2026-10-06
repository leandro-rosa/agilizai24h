import { signedPct } from "./compare";
import type { ValueDelta } from "./compare";
import { moneyCompact, period as fmtPeriod } from "../format";
import type { Insight, KpiResult, Overview } from "./types";

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthName = (p: string) => `${MONTH_NAMES[Number(p.split("-")[1]) - 1]}/${p.split("-")[0]}`;

const k = (kpis: KpiResult[], key: KpiResult["key"]) => kpis.find((x) => x.key === key);
const d = (x?: KpiResult) => (x?.vsPrevious as ValueDelta | undefined)?.pct ?? null;

/**
 * Parágrafo curto montado só de números já calculados (com a base entre parênteses).
 * Toda frase é omitida quando falta o dado; adjetivo e causa não entram.
 */
export function buildReading(args: Pick<Overview, "period" | "previousPeriod" | "kpis" | "stores" | "products" | "cashUses" | "cash"> & { insights: Insight[] }): string {
  const parts: string[] = [];
  const revK = k(args.kpis, "revenue");
  const rev = d(revK);
  const loss = d(k(args.kpis, "loss"));
  const op = d(k(args.kpis, "operating"));
  const prev = fmtPeriod(args.previousPeriod);
  const base = revK?.previous != null && revK.value != null ? ` (${moneyCompact(revK.previous)} → ${moneyCompact(revK.value)})` : "";

  if (rev !== null) parts.push(`${monthName(args.period)} fechou com faturamento ${signedPct(rev)} vs. ${prev}${base}${loss !== null ? ` e perdas ${signedPct(loss)}` : ""}.`);
  else if (loss !== null) parts.push(`${monthName(args.period)} fechou com perdas ${signedPct(loss)} vs. ${prev}.`);
  if (op !== null) parts.push(`O resultado operacional variou ${signedPct(op)}.`);

  if (args.cash.operatingPositiveCashFell) {
    const drivers = args.insights.filter((x) => x.id === "capex" || x.id.startsWith("cat:")).slice(0, 2).map((x) => (x.id === "capex" ? "CAPEX" : args.cashUses?.lines.find((l) => l.key === x.id)?.label ?? x.id));
    parts.push(`O caixa caiu com resultado operacional positivo${drivers.length ? `; houve variação material em ${drivers.join(" e ")} (observação, sem conclusão de causa)` : ""}.`);
  }

  const g = args.stores?.growthExplainers;
  const dn = args.stores?.declineExplainers;
  if (g?.stores.length && dn?.stores.length) parts.push(`Nas vendas das lojas, ${g.stores.length} ${g.stores.length === 1 ? "loja explica" : "lojas explicam"} ${Math.round(g.coveredShare * 100)}% do aumento e ${dn.stores.length} ${dn.stores.length === 1 ? "loja explica" : "lojas explicam"} ${Math.round(dn.coveredShare * 100)}% da queda.`);
  else if (g?.stores.length) parts.push(`Nas vendas das lojas, ${g.stores.length} ${g.stores.length === 1 ? "loja explica" : "lojas explicam"} ${Math.round(g.coveredShare * 100)}% do aumento.`);
  else if (dn?.stores.length) parts.push(`Nas vendas das lojas, ${dn.stores.length} ${dn.stores.length === 1 ? "loja explica" : "lojas explicam"} ${Math.round(dn.coveredShare * 100)}% da queda.`);

  const falling = args.products?.falling.filter((p) => p.behavior === "queda_consistente") ?? [];
  if (falling.length) parts.push(`${falling.length} ${falling.length === 1 ? "produto relevante apresenta" : "produtos relevantes apresentam"} queda consistente de unidades.`);

  return parts.join(" ");
}
