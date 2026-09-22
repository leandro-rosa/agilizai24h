import type { LossReason, Period, ReconciliationInput } from "./types";

/** Quais dos `periods` dados tiveram perda (quantidade > 0) para este SKU e motivo. */
export function periodsWithLoss(reconciliations: ReconciliationInput[], sku: string, reason: LossReason, periods: Period[]): Period[] {
  return periods.filter((period) => {
    const qty = reconciliations
      .filter((r) => r.period === period)
      .flatMap((r) => r.loss_by_reason_sku.filter((row) => row.sku === sku && row.reason === reason))
      .reduce((total, row) => total + row.quantity, 0);
    return qty > 0;
  });
}
