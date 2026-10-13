import { contains, type Period } from './consignment-period'
import type { KeyedSale } from './consignment-sale-key'

/** What a confirmed closing counted for a sale key (original line or an earlier adjustment): lines of one key are summed here. */
export interface ConfirmedSaleLine {
  saleKey: string
  /** The supplier whose confirmed closing counted the sale. */
  supplierId: number
  storeId: number
  sku: string
  quantity: number
  unitCostCents: number
}

export type AdjustmentKind = 'adjustment_cancel' | 'adjustment_late' | 'adjustment_qty'

export interface Adjustment {
  saleKey: string
  kind: AdjustmentKind
  /** Owner of the confirmed line being adjusted; null for a late sale, whose supplier the closing attributes. */
  supplierId: number | null
  storeId: number
  sku: string
  occurredAt: Date | null
  /** Signed delta in units. */
  quantity: number
  /** Null for a late sale: the closing resolves the cost in force on the sale day. */
  unitCostCents: number | null
}

/**
 * Compares what confirmed closings counted with the sales as they stand now. A confirmed closing is never reopened:
 * differences become traceable adjustments for the next open closing.
 */
export function computeAdjustments(input: { confirmed: ConfirmedSaleLine[]; current: KeyedSale[]; covered: Period[] }): { adjustments: Adjustment[]; missing: string[] } {
  const currentByKey = new Map(input.current.map(s => [s.key, s]))
  const confirmedKeys = new Set(input.confirmed.map(l => l.saleKey))
  const counted = new Map<string, ConfirmedSaleLine>()
  for (const line of input.confirmed) {
    const seen = counted.get(line.saleKey)
    counted.set(line.saleKey, seen ? { ...seen, quantity: seen.quantity + line.quantity } : line)
  }
  const adjustments: Adjustment[] = []
  const missing: string[] = []

  for (const line of counted.values()) {
    const now = currentByKey.get(line.saleKey)
    if (!now) {
      missing.push(line.saleKey)
      continue
    }
    const wanted = now.result === 'OK' ? now.quantity : 0
    if (wanted === line.quantity) continue
    adjustments.push({
      saleKey: line.saleKey,
      kind: wanted === 0 ? 'adjustment_cancel' : 'adjustment_qty',
      supplierId: line.supplierId,
      storeId: line.storeId,
      sku: line.sku,
      occurredAt: now.occurredAt,
      quantity: wanted - line.quantity,
      unitCostCents: line.unitCostCents,
    })
  }

  for (const sale of input.current) {
    if (confirmedKeys.has(sale.key) || sale.result !== 'OK') continue
    if (!input.covered.some(period => contains(period, sale.occurredAt))) continue
    adjustments.push({ saleKey: sale.key, kind: 'adjustment_late', supplierId: null, storeId: sale.storeId, sku: sale.sku, occurredAt: sale.occurredAt, quantity: sale.quantity, unitCostCents: null })
  }

  return { adjustments, missing }
}
