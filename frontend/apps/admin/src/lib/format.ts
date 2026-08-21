/**
 * Formatação compartilhada. Estava duplicada em cada página como um
 * `new Intl.NumberFormat` solto; com doze telas novas isso vira doze cópias
 * que divergem na primeira vez que alguém muda casas decimais.
 */
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR");

/** Centavos → "R$ 1.234,56". */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return currency.format(cents / 100);
}

/** Centavos → "R$ 1,2 mil", para eixo de gráfico e KPI apertado. */
export function moneyCompact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `R$ ${compact.format(cents / 100)}`;
}

export function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : integer.format(value);
}

/** Basis points → "5,0%". */
export function bps(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${(value / 100).toFixed(fractionDigits)}%`;
}

/** "2026-07-16" ou ISO → "16/07/2026". Sem fuso: a data já vem em UTC. */
export function date(value: string | null | undefined): string {
  if (!value) return "—";
  const [iso] = value.split("T");
  const [y, m, d] = iso.split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

/** "2026-07" → "jul/2026". */
export function period(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month] = value.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(month) - 1] ?? month}/${year}`;
}

/** O mês corrente, no formato que todo serviço usa. */
export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
