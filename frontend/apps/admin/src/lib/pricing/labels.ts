import type { StatusTone } from "@/components/status-badge";
import type { Confidence, PricingStatus } from "@/lib/api/pricing";

/** Vocabulário combinado com o dono: cinco situações e quatro confianças. */
export const STATUS_LABEL: Record<PricingStatus, string> = {
  healthy: "Saudável",
  adjust: "Ajustar",
  opportunity: "Oportunidade",
  review: "Revisar",
  insufficient_data: "Dados insuficientes",
};

/** Verde saudável, amarelo atenção, vermelho problema — e só. Oportunidade é neutra: não é erro nem aprovação. */
export const STATUS_TONE: Record<PricingStatus, StatusTone> = {
  healthy: "positive",
  adjust: "attention",
  opportunity: "neutral",
  review: "attention",
  insufficient_data: "neutral",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  insufficient_data: "Dados insuficientes",
};

export const CONFIDENCE_TONE: Record<Confidence, StatusTone> = {
  high: "positive",
  medium: "neutral",
  low: "attention",
  insufficient_data: "neutral",
};

/** Fração → "35,0%". `null` nunca vira 0: é "—". */
export function percent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";

  return `${(fraction * 100).toFixed(digits).replace(".", ",")}%`;
}

/** Diferença de margem em pontos percentuais: "+1,8 p.p." / "−2,0 p.p.". `null` é "—". */
export function points(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  const value = fraction * 100;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";

  return `${sign}${Math.abs(value).toFixed(digits).replace(".", ",")} p.p.`;
}

/** Variação relativa: "+10,4%" / "−3,0%". */
export function signedPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  const value = fraction * 100;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";

  return `${sign}${Math.abs(value).toFixed(digits).replace(".", ",")}%`;
}

/** Centavos com sinal para um impacto: "+ R$ 420,00" / "− R$ 15,00". `null` é "—". */
export function signedMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const abs = Math.abs(cents) / 100;
  const text = abs.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return `${cents > 0 ? "+ " : cents < 0 ? "− " : ""}${text}`;
}

/** Reais digitados ("6,50", "R$ 6,50", "6.50") → centavos inteiros; `null` quando não é um preço válido. */
export function parsePriceToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return null;
  // A vírgula é o decimal; o ponto só é decimal quando não há vírgula e vem antes de 1–2 dígitos finais.
  const normalised = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : /\.\d{1,2}$/.test(cleaned) ? cleaned : cleaned.replace(/\./g, "");
  const value = Number(normalised);
  if (!Number.isFinite(value) || value <= 0) return null;

  return Math.round(value * 100);
}
