export interface ClassifiedRemoval {
  sku: string
  reasonKey: string
  countsAsLoss: boolean
  quantityRemoved: number
}

export interface LossByReason {
  reason: string
  quantity: number
}

export interface LossBySku {
  sku: string
  quantity: number
}

export interface DerivedLoss {
  total: number
  byReason: LossByReason[]
  bySku: LossBySku[]
}

/**
 * Derives real loss from already-classified removals.
 *
 * Derived on read rather than stored: a stored loss column is a denormalisation
 * that can drift from the per-reason rows it summarises, and the drift is
 * invisible. Deriving means the rows are the single source of truth, and the
 * classification flag can be corrected without a backfill.
 *
 * Pure, so the defining case — 9 units removed as 6 return and 3 other reason
 * yielding 3 units of loss, not 9 — is testable without any I/O.
 */
export function deriveLoss(removals: ClassifiedRemoval[]): DerivedLoss {
  const lossOnly = removals.filter(removal => removal.countsAsLoss)

  const byReason = new Map<string, number>()
  const bySku = new Map<string, number>()
  let total = 0

  for (const removal of lossOnly) {
    total += removal.quantityRemoved
    byReason.set(removal.reasonKey, (byReason.get(removal.reasonKey) ?? 0) + removal.quantityRemoved)
    bySku.set(removal.sku, (bySku.get(removal.sku) ?? 0) + removal.quantityRemoved)
  }

  return {
    total,
    byReason: [...byReason.entries()].map(([reason, quantity]) => ({ reason, quantity })).sort(byReasonName),
    bySku: [...bySku.entries()].map(([sku, quantity]) => ({ sku, quantity })).sort(bySkuName),
  }
}

const byReasonName = (a: LossByReason, b: LossByReason) => a.reason.localeCompare(b.reason)
const bySkuName = (a: LossBySku, b: LossBySku) => a.sku.localeCompare(b.sku)
