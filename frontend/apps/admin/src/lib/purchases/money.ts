import type { Condition } from "@/lib/api/purchases";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** `8,50`, `8.50`, `1.234,56` ou `R$ 8,50` → centavos inteiros; `null` quando não dá para ler. */
export function parseMoneyToCents(text: string): number | null {
  const cleaned = text.replace(/R\$|\s/g, "");
  if (cleaned === "") return null;
  // Com vírgula: ponto é separador de milhar. Só com ponto: é decimal.
  const normalised = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;

  return Math.round(Number(normalised) * 100);
}

export const formatCents = (cents: number): string => brl.format(cents / 100);

export const CONDITION_LABEL: Record<Condition, string> = {
  paid: "Pago",
  bonus: "Bonificação",
  on_sale: "Consignado (pago sobre a venda)",
};

export const CONDITION_SHORT: Record<Condition, string> = { paid: "Pago", bonus: "Bonificação", on_sale: "Consignado" };

/** `2026-10-07` → a segunda-feira da semana (ISO). */
export function weekStartOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - weekday * 86_400_000).toISOString().slice(0, 10);
}

/** `2026-10-05` → `05/10/2026`. */
export function formatDate(day: string | null): string {
  return day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "—";
}

/**
 * O que a nota diz virou o que o painel registra: UNIDADES e o custo de UMA unidade. A nota costuma trazer o preço do fardo/caixa,
 * então `pack` (unidades por embalagem) divide o custo e multiplica a quantidade. `null` quando não dá para registrar sem adivinhar.
 */
export function packConversion(quantity: number, unitCostCents: number, pack: number): { units: number; unitCostCents: number } | null {
  if (!Number.isInteger(pack) || pack < 1) return null;
  const units = quantity * pack;
  if (!Number.isInteger(units) || units < 1) return null;

  return { units, unitCostCents: Math.round(unitCostCents / pack) };
}
