/**
 * Display labels for the six removal reasons, matching the project glossary
 * and `supply-service`'s own `REMOVAL_REASONS` (the table there stays
 * authoritative for the loss rule itself — this is presentation only).
 */
export const REMOVAL_REASON_LABELS: Record<string, string> = {
  expired: "Validade vencida",
  damaged_product: "Produto danificado",
  other_reason: "Outro motivo",
  return: "Devolução",
  transfer: "Transferência",
  internal_use: "Uso e consumo",
};

export const LOSS_COUNTING_REASONS = new Set(["expired", "damaged_product", "other_reason"]);

export function reasonLabel(key: string): string {
  return REMOVAL_REASON_LABELS[key] ?? key;
}
