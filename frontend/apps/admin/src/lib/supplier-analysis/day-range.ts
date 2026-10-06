/** Um intervalo de dias reais (`YYYY-MM-DD`), as duas pontas incluídas. */
export interface DayRange {
  from: string;
  to: string;
}

/** O mais longo que a análise lê de uma vez (a API recusa mais que isso). */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const ms = (day: string) => new Date(`${day}T00:00:00Z`).getTime();
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

export function addDays(day: string, delta: number): string {
  return iso(ms(day) + delta * DAY_MS);
}

export function dayCount({ from, to }: DayRange): number {
  return Math.round((ms(to) - ms(from)) / DAY_MS) + 1;
}

export function lastDayOfMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return iso(Date.UTC(year, number, 0));
}

export function addMonthsTo(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** O mês inteiro, do dia 1 ao último dia. */
export function monthRange(month: string): DayRange {
  return { from: `${month}-01`, to: lastDayOfMonth(month) };
}

/** Os `months` meses que terminam no mês de `end`, inteiros. */
export function monthsEndingAt(end: string, months: number): DayRange {
  const endMonth = end.slice(0, 7);
  return { from: `${addMonthsTo(endMonth, -(months - 1))}-01`, to: lastDayOfMonth(endMonth) };
}

/** Os últimos `days` dias que terminam em `end`. */
export function lastDays(end: string, days: number): DayRange {
  return { from: addDays(end, -(days - 1)), to: end };
}

export function isWholeMonths({ from, to }: DayRange): boolean {
  return from.endsWith("-01") && to === lastDayOfMonth(to.slice(0, 7));
}

function monthSpan({ from, to }: DayRange): number {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Desloca o intervalo pelo próprio tamanho: meses inteiros andam de mês em mês, dias andam de dia em dia.
 * Devolve `null` quando passaria de `latest` (o último dia com dado fechado).
 */
export function shiftRange(range: DayRange, direction: -1 | 1, latest: string): DayRange | null {
  const next = isWholeMonths(range)
    ? monthsEndingAt(`${addMonthsTo(range.to.slice(0, 7), direction * monthSpan(range))}-01`, monthSpan(range))
    : { from: addDays(range.from, direction * dayCount(range)), to: addDays(range.to, direction * dayCount(range)) };

  return next.to > latest ? null : next;
}

/** Corta um intervalo longo demais mantendo o fim; `clamped` diz se precisou cortar. */
export function clampRange(range: DayRange): { range: DayRange; clamped: boolean } {
  if (dayCount(range) <= MAX_RANGE_DAYS) return { range, clamped: false };
  return { range: lastDays(range.to, MAX_RANGE_DAYS), clamped: true };
}

/** `2026-09-30` → `30/09/2026`. */
export function formatDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}
