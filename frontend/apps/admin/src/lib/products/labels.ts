import type { Product, VersionSource } from "@/lib/api/products";

export const SOURCE_LABEL: Record<VersionSource, string> = {
  manual: "Manual",
  invoice: "Nota fiscal",
  pricing_intelligence: "Precificação Inteligente",
  catalogue_sync: "Sincronização da precificação",
  legacy_import: "Carga inicial (origem não registrada)",
  other: "Outra",
};

export const CATEGORY_LABEL: Record<Product["category"], string> = { meal: "Refeição", snack: "Lanche", beverage: "Bebida", essential: "Essencial" };

export const STATUS_LABEL: Record<string, string> = { active: "Ativo", discontinued: "Descontinuado" };

const dayText = (day: string | null) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "—");

/** Como o cadastro nasceu, em uma frase. Nunca inventa o que não foi registrado. */
export function originText(origin: Product["origin"]): string {
  if (!origin) return "Origem não informada";
  if (origin.type === "invoice") return `Cadastro originado de NF-e ${origin.invoice_number ?? ""} em ${dayText(origin.on)}${origin.actor ? ` por ${origin.actor}` : ""}`.replace("  ", " ");
  if (origin.type === "legacy_import") return "Carga inicial — origem não registrada";

  return origin.actor ? `Cadastro manual por ${origin.actor}` : "Cadastro manual";
}

/** `2026-10-10T12:00:00.000Z` ou `2026-10-10` → `10/10/2026`. */
export const isoDay = (value: string): string => dayText(value.slice(0, 10));
