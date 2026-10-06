/**
 * The weekly settlement of on-sale (consignado) items — pure, so the rule can be read and tested on its own.
 *
 * Owed = units sold × the agreed unit cost. What was not sold, expired or was returned is not owed. Units are
 * allocated item by item, oldest delivery first, against what is still open (delivered − already owed in earlier
 * confirmed weeks − already written off). Write-offs (expired, returned) are applied before sales: a unit that
 * expired cannot also have sold.
 */
export interface OnSaleItem {
  itemId: number
  /** `YYYY-MM-DD` of the purchase, to order the deliveries. */
  deliveredOn: string
  sku: string
  quantity: number
  unitCostCents: number
}

/** What earlier CONFIRMED settlements already accounted for, per item. */
export interface PriorLine {
  itemId: number
  owedUnits: number
  writtenOffUnits: number
}

/** Expired and returned units the operator reports for this week, per item. */
export interface WriteOff {
  itemId: number
  expired: number
  returned: number
}

export interface SettlementLine {
  itemId: number
  sku: string
  unitCostCents: number
  delivered: number
  /** Open at the start of the week: delivered − owed before − written off before. */
  openBefore: number
  sold: number
  expired: number
  returned: number
  /** Still open at the end of the week: neither sold, expired nor returned (yet). */
  unsold: number
  owedUnits: number
  owedCents: number
  /** The reported write-offs were more than what was open, and were capped. */
  writeOffCapped: boolean
}

export interface SettlementResult {
  lines: SettlementLine[]
  owedCents: number
  /** Sold units of a SKU beyond the open on-sale units: they came from stock that is not on sale and are not owed here. */
  soldNotCovered: Record<string, number>
}

export function computeSettlement(input: {
  items: OnSaleItem[]
  /** Units sold in the week, network-wide, by SKU. */
  soldBySku: Map<string, number>
  writeOffs: WriteOff[]
  prior: PriorLine[]
}): SettlementResult {
  const priorOf = new Map<number, PriorLine>(input.prior.map(p => [p.itemId, p]))
  const writeOffOf = new Map<number, WriteOff>(input.writeOffs.map(w => [w.itemId, w]))
  const pool = new Map(input.soldBySku)
  const lines: SettlementLine[] = []

  const ordered = [...input.items].sort((a, b) => a.deliveredOn.localeCompare(b.deliveredOn) || a.itemId - b.itemId)

  for (const item of ordered) {
    const before = priorOf.get(item.itemId)
    const openBefore = Math.max(0, item.quantity - (before?.owedUnits ?? 0) - (before?.writtenOffUnits ?? 0))
    const reported = writeOffOf.get(item.itemId)
    const expiredAsked = Math.max(0, reported?.expired ?? 0)
    const returnedAsked = Math.max(0, reported?.returned ?? 0)

    const expired = Math.min(expiredAsked, openBefore)
    const returned = Math.min(returnedAsked, openBefore - expired)
    const afterWriteOff = openBefore - expired - returned

    const available = pool.get(item.sku) ?? 0
    const sold = Math.min(available, afterWriteOff)
    pool.set(item.sku, available - sold)

    lines.push({
      itemId: item.itemId,
      sku: item.sku,
      unitCostCents: item.unitCostCents,
      delivered: item.quantity,
      openBefore,
      sold,
      expired,
      returned,
      unsold: afterWriteOff - sold,
      owedUnits: sold,
      owedCents: sold * item.unitCostCents,
      writeOffCapped: expired < expiredAsked || returned < returnedAsked,
    })
  }

  const soldNotCovered: Record<string, number> = {}
  for (const [sku, left] of pool) if (left > 0 && input.items.some(i => i.sku === sku)) soldNotCovered[sku] = left

  return { lines, owedCents: lines.reduce((sum, line) => sum + line.owedCents, 0), soldNotCovered }
}
