/**
 * "A receber vencido" com cliente e dias de atraso. Nota vence em `due_on` (emissão + prazo do contrato; ex.: Ascenty e
 * Rolls-Royce pagam 30 dias após a emissão). Vencida = dias de atraso ≥ 1 na data de referência (a que vence hoje não conta).
 *
 * O sistema grava a data de pagamento IGUAL à do vencimento nas notas já baixadas, então o histórico não revela quanto cada
 * cliente costuma atrasar; por isso o corte entre atraso curto e longo é PREMISSA, a validar com o dono.
 */
export const OVERDUE = {
  /** Até N dias depois do vencimento: em geral é compensação bancária/baixa pendente, não inadimplência. */
  SHORT_DAYS: 5,
} as const;

export interface OpenInvoice {
  clientName: string;
  amountCents: number;
  /** YYYY-MM-DD */
  dueOn: string;
}

export interface OverdueClient {
  name: string;
  count: number;
  cents: number;
  maxDaysOverdue: number;
}

export interface OverdueDetail {
  referenceDate: string;
  count: number;
  totalCents: number;
  maxDaysOverdue: number;
  byClient: OverdueClient[];
  /** Vencido há no máximo `OVERDUE.SHORT_DAYS` dias. */
  short: { count: number; cents: number };
  /** Vencido há mais que isso — o que de fato merece atenção. */
  long: { count: number; cents: number };
}

const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** `null` quando não há notas vencidas (nada a detalhar); o total de zero continua vindo do aging. */
export function buildOverdueDetail(invoices: OpenInvoice[], referenceDate: string): OverdueDetail | null {
  const ref = day(referenceDate);
  const overdue = invoices
    .map((i) => ({ ...i, days: Math.floor((ref - day(i.dueOn)) / 86_400_000) }))
    .filter((i) => i.days >= 1);
  if (overdue.length === 0) return null;

  const clients = new Map<string, OverdueClient>();
  const short = { count: 0, cents: 0 };
  const long = { count: 0, cents: 0 };
  for (const i of overdue) {
    const c = clients.get(i.clientName) ?? { name: i.clientName, count: 0, cents: 0, maxDaysOverdue: 0 };
    c.count += 1;
    c.cents += i.amountCents;
    c.maxDaysOverdue = Math.max(c.maxDaysOverdue, i.days);
    clients.set(i.clientName, c);
    const bucket = i.days <= OVERDUE.SHORT_DAYS ? short : long;
    bucket.count += 1;
    bucket.cents += i.amountCents;
  }
  return {
    referenceDate,
    count: overdue.length,
    totalCents: overdue.reduce((s, i) => s + i.amountCents, 0),
    maxDaysOverdue: Math.max(...overdue.map((i) => i.days)),
    byClient: [...clients.values()].sort((a, b) => b.cents - a.cents),
    short,
    long,
  };
}

/** "R$ 33.348 · 24 notas · Ascenty (23), Rolls-Royce (1) · até 2 dias de atraso" — pronto para tela e PDF. */
export function overdueSummary(d: OverdueDetail, money: (cents: number) => string): string {
  const who = d.byClient.map((c) => `${c.name} (${c.count})`).join(", ");
  return `${money(d.totalCents)} · ${d.count} ${d.count === 1 ? "nota" : "notas"} · ${who} · ${d.maxDaysOverdue === 1 ? "1 dia" : `até ${d.maxDaysOverdue} dias`} de atraso`;
}
