/**
 * Display labels for the four unvalued-SKU reasons, matching
 * `products-contracts`'s `UNRESOLVED_COST_REASONS` (that table stays
 * authoritative for the classification itself — this is presentation only).
 */
export const UNVALUED_REASON_LABELS: Record<string, string> = {
  unknown_sku: "SKU desconhecido",
  no_cost_for_date: "Sem custo para a data",
  ambiguous_name: "Nome ambíguo",
  unknown_name: "Nome desconhecido",
};

export function unvaluedReasonLabel(key: string): string {
  return UNVALUED_REASON_LABELS[key] ?? key;
}
