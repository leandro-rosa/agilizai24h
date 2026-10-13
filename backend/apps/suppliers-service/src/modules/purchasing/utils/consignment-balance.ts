import type { KeyedSale } from './consignment-sale-key'

export type MovementKind = 'opening' | 'receipt' | 'transfer_in' | 'transfer_out' | 'expiry_writeoff' | 'return_sellable' | 'loss' | 'correction'

/** `quantity` is signed: transfer_out, expiry_writeoff, return_sellable and losses are negative. */
export interface Movement {
  supplierId: number
  sku: string
  location: string
  kind: MovementKind
  quantity: number
  occurredAt: Date
}

export interface Balance {
  balance: number
  /** A negative balance means the movement data is wrong somewhere; it is reported, never clamped. */
  negative: boolean
  netSales: number
  byKind: Partial<Record<MovementKind, number>>
}

export const storeLocation = (storeId: number) => `store:${storeId}`

/**
 * Balance at `at` = movements (the opening at the cutoff, then everything after it) − OK sales since the cutoff.
 * Sales are never ledger movements, so confirming a closing neither subtracts them again nor hides them here.
 *
 * With `supplierId`, only the sales attributed to THAT supplier (`saleSupplier`: sale key → supplier id) are subtracted;
 * an unattributed sale reduces nobody's figure until it is attributed. Without it the figure is the location total.
 * A sale at the cutoff instant belongs to the first period, so it counts (`>= cutoff`).
 */
export function computeBalance(input: { supplierId?: number; sku: string; location: string; cutoff: Date; at: Date; movements: Movement[]; sales: KeyedSale[]; saleSupplier?: Map<string, number> }): Balance {
  const byKind: Partial<Record<MovementKind, number>> = {}
  let ledger = 0

  for (const movement of input.movements) {
    if (movement.sku !== input.sku || movement.location !== input.location) continue
    if (input.supplierId !== undefined && movement.supplierId !== input.supplierId) continue
    const counted = movement.kind === 'opening' ? movement.occurredAt <= input.at : movement.occurredAt > input.cutoff && movement.occurredAt <= input.at
    if (!counted) continue
    ledger += movement.quantity
    byKind[movement.kind] = (byKind[movement.kind] ?? 0) + movement.quantity
  }

  const netSales = input.sales
    .filter(s => s.result === 'OK' && s.sku === input.sku && s.occurredAt >= input.cutoff && s.occurredAt <= input.at && input.location === `store:${s.storeId}`)
    .filter(s => input.supplierId === undefined || input.saleSupplier?.get(s.key) === input.supplierId)
    .reduce((sum, s) => sum + s.quantity, 0)

  const balance = ledger - netSales

  return { balance, negative: balance < 0, netSales, byKind }
}
