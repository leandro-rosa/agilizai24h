/** Number formatting for the page. `pt-BR` throughout, so a decimal is a comma. */

const percentFormatter = (digits: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const ONE = percentFormatter(1);
const ZERO = percentFormatter(0);
const TWO = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 0.518 → "51,8%"; null → "—". */
export function pct(value: number | null | undefined, digits: 0 | 1 = 1): string {
  if (value === null || value === undefined) return "—";
  return `${(digits === 0 ? ZERO : ONE).format(value * 100)}%`;
}

/** 2.5 → "2,50". */
export function decimal(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : TWO.format(value);
}
