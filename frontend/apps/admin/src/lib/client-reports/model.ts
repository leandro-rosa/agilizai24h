import type { ClientDivergenceReport, ClientDivergenceRow, ClientDivergenceUnit } from "@/lib/api/client-reports";

/**
 * What the screen, the PDF and the Excel all print. Every string a person reads lives here once, so the three
 * outputs cannot word the same fact differently. Money is integer centavos end to end; a unit price times an
 * integer quantity is exact, so there is no rounding rule to keep consistent.
 */

export const NOT_AVAILABLE = "Não disponível";
export const PRICE_NOT_AVAILABLE = "Preço não disponível";
export const VALUE_NOT_AVAILABLE = "Indisponível";
export const REPORT_TITLE = "Relatório de divergências de estoque";
export const PERIOD_NOTE = "Período considerado pela data de identificação da divergência.";
export const PRICE_NOTE = "Valores calculados pelo preço de venda.";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-05-07" → "07/05/2026". A report day, never passed through `Date`. */
export function formatDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-05-07T10:05:00.000Z" → "07/05/2026 10:05". The report states the wall-clock time; the UTC fields ARE that time (no conversion). */
export function formatInstant(iso: string | null): string {
  if (iso === null) return NOT_AVAILABLE;
  const date = new Date(iso);
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NBSP = /\u00a0/g;

/** Centavos → "R$ 1.234,56" with a regular space (the PDF font has no non-breaking space). */
export function formatCents(cents: number): string {
  return BRL.format(cents / 100).replace(NBSP, " ");
}

export const priceText = (row: ClientDivergenceRow): string => (row.unit_price_cents === null ? PRICE_NOT_AVAILABLE : formatCents(row.unit_price_cents));
export const lossText = (row: ClientDivergenceRow): string => (row.loss_cents === null ? VALUE_NOT_AVAILABLE : formatCents(row.loss_cents));
export const unitsText = (quantity: number): string => `${quantity} un.`;

/** A subtotal or a total: "R$ 100,00", or "R$ 70,00 (parcial)" when some price is missing. */
export const totalText = (cents: number, partial: boolean): string => (partial ? `${formatCents(cents)} (parcial)` : formatCents(cents));

export function partialNote(unpricedRows: number): string {
  return `${unpricedRows} ${unpricedRows === 1 ? "ocorrência sem preço de venda" : "ocorrências sem preço de venda"}: o valor total é parcial.`;
}

/** Only the units that have occurrences go into a document; a unit with none produces no rows and no page. */
export const unitsWithRows = (report: ClientDivergenceReport): ClientDivergenceUnit[] => report.units.filter((unit) => unit.rows.length > 0);

export const periodText = (report: Pick<ClientDivergenceReport, "from" | "to">): string => `${formatDay(report.from)} a ${formatDay(report.to)}`;

export function fileBase(report: ClientDivergenceReport, extension: "pdf" | "xlsx"): string {
  const safe = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Divergencias-${safe(report.client.name)}-${report.from}-a-${report.to}.${extension}`;
}
