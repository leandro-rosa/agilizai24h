/**
 * Every real backend period is a whole month (`YYYY-MM`) — there is no
 * daily or weekly grain anywhere in the pipeline (the source sales reports
 * carry no date column at all). A "range" here is always a run of whole
 * months; quarter/semester/year presets are just a run of 3/6/12
 * consecutive months, nothing more granular is honestly buildable.
 */
export interface PeriodRange {
  start: string;
  end: string;
}

/** The last complete calendar month — the current one never has a closed reconciliation behind it. */
export function lastCompleteMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every month from `start` to `end`, inclusive, oldest first. */
export function monthsInRange({ start, end }: PeriodRange): string[] {
  const months: string[] = [];
  let cursor = start;
  // A monthly range spans at most a few years in this app; the guard only
  // stops a reversed or malformed range from looping forever.
  for (let guard = 0; guard < 600 && cursor.localeCompare(end) <= 0; guard += 1) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

/** Quarter/semester/year presets, anchored to the given end month. */
export function presetRange(preset: "month" | "quarter" | "semester" | "year", end: string): PeriodRange {
  const span = { month: 0, quarter: 2, semester: 5, year: 11 }[preset];
  return { start: addMonths(end, -span), end };
}

export function defaultRange(): PeriodRange {
  const end = lastCompleteMonth();
  return { start: end, end };
}
