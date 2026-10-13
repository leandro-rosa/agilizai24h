import type { Adjustment, AdjustmentKind } from './consignment-adjustments'
import { attributeSale, type SupplierBalance } from './consignment-attribution'
import { resolveCost, type CostVigencia } from './consignment-cost'
import { contains, type Period } from './consignment-period'
import type { KeyedSale, SaleFact } from './consignment-sale-key'

export interface ClosingInput {
  supplierId: number
  period: Period
  cutoff: Date
  /** Keyed sales of the supplier's linked SKUs, any result. */
  sales: KeyedSale[]
  /** Linked-SKU sales without an instant or receipt identifier that could belong to this closing. */
  unidentifiedSales: SaleFact[]
  /** Suppliers with ledger entries for the sale's SKU in its store, with their balance strictly BEFORE the sale (see attributeSale). */
  holdersOf: (sale: KeyedSale) => SupplierBalance[]
  /** Manual attributions: sale key → supplier id. */
  manualAssignments: Map<string, number>
  costs: CostVigencia[]
  /** Sale keys already counted by a confirmed closing with an active financial obligation. */
  claimedKeys: Set<string>
  /** Intervals already settled by legacy weekly settlements: their sales are never charged again. */
  legacyCovered: Period[]
  adjustments: Adjustment[]
  /** Confirmed sale keys absent from the latest import: they may reappear under another key, so they block until resolved. */
  missingKeys: string[]
  /** Latest instant the sales imports reach; null when unknown. */
  salesImportedUntil: Date | null
  /** The operator accepted a partial period (permission, confirmation and justification live in the service). */
  partialAccepted: boolean
}

export interface ClosingLine {
  storeId: number
  sku: string
  /** One line per cost vigência, so differing costs are never hidden behind one number. */
  costValidFrom: string
  unitCostCents: number
  netUnits: number
  totalCents: number
  saleKeys: string[]
}

export type BlockerCode = 'sale_unidentified' | 'attribution_pending' | 'cost_missing' | 'sales_incomplete' | 'sale_missing'

export interface Blocker {
  code: BlockerCode
  saleKey?: string
  storeId?: number
  sku?: string
}

export interface PricedAdjustment {
  saleKey: string
  kind: AdjustmentKind
  storeId: number
  sku: string
  quantity: number
  unitCostCents: number
  totalCents: number
}

export interface ClosingResult {
  lines: ClosingLine[]
  cancellations: Array<{ storeId: number; sku: string; units: number }>
  adjustments: PricedAdjustment[]
  salesCents: number
  adjustmentsCents: number
  owedCents: number
  blockers: Blocker[]
  confirmable: boolean
}

/**
 * Owed = Σ net units sold × agreed cost in force on the sale day. Expired or returned units are not an input here on
 * purpose: they are not owed and are never subtracted from the sales.
 */
export function computeClosing(input: ClosingInput): ClosingResult {
  const blockers: Blocker[] = []
  const lines = new Map<string, ClosingLine>()
  const cancelled = new Map<string, { storeId: number; sku: string; units: number }>()

  for (const loose of input.unidentifiedSales) blockers.push({ code: 'sale_unidentified', storeId: loose.storeId, sku: loose.sku })

  const eligible = input.sales.filter(
    s => contains(input.period, s.occurredAt) && s.occurredAt >= input.cutoff && !input.claimedKeys.has(s.key) && !input.legacyCovered.some(p => contains(p, s.occurredAt)),
  )

  for (const sale of eligible) {
    const attribution = attributeSale(input.holdersOf(sale), input.manualAssignments.get(sale.key))
    if (sale.result === 'OK' && attribution.pending) {
      blockers.push({ code: 'attribution_pending', saleKey: sale.key, storeId: sale.storeId, sku: sale.sku })
      continue
    }
    if (attribution.supplierId !== input.supplierId) continue

    if (sale.result !== 'OK') {
      const id = `${sale.storeId}|${sale.sku}`
      const entry = cancelled.get(id) ?? { storeId: sale.storeId, sku: sale.sku, units: 0 }
      entry.units += sale.quantity
      cancelled.set(id, entry)
      continue
    }

    const cost = resolveCost(input.costs, sale.sku, sale.occurredAt)
    if (!cost) {
      blockers.push({ code: 'cost_missing', saleKey: sale.key, storeId: sale.storeId, sku: sale.sku })
      continue
    }
    const id = `${sale.storeId}|${sale.sku}|${cost.validFrom}`
    const line = lines.get(id) ?? { storeId: sale.storeId, sku: sale.sku, costValidFrom: cost.validFrom, unitCostCents: cost.unitCostCents, netUnits: 0, totalCents: 0, saleKeys: [] }
    line.netUnits += sale.quantity
    line.totalCents += sale.quantity * cost.unitCostCents
    line.saleKeys.push(sale.key)
    lines.set(id, line)
  }

  for (const key of input.missingKeys) blockers.push({ code: 'sale_missing', saleKey: key })

  const salesByKey = new Map(input.sales.map(s => [s.key, s]))
  const adjustments: PricedAdjustment[] = []
  for (const adjustment of input.adjustments) {
    if (adjustment.kind === 'adjustment_late') {
      // A late sale goes through the same guards as a regular one: it is nobody's until it is attributed.
      const late = salesByKey.get(adjustment.saleKey)
      if (!late) {
        blockers.push({ code: 'attribution_pending', saleKey: adjustment.saleKey, storeId: adjustment.storeId, sku: adjustment.sku })
        continue
      }
      if (input.claimedKeys.has(late.key) || late.occurredAt < input.cutoff || input.legacyCovered.some(p => contains(p, late.occurredAt))) continue
      const attribution = attributeSale(input.holdersOf(late), input.manualAssignments.get(late.key))
      if (attribution.pending) {
        blockers.push({ code: 'attribution_pending', saleKey: late.key, storeId: late.storeId, sku: late.sku })
        continue
      }
      if (attribution.supplierId !== input.supplierId) continue
    } else if (adjustment.supplierId !== input.supplierId) continue

    const cost = adjustment.unitCostCents ?? (adjustment.occurredAt ? resolveCost(input.costs, adjustment.sku, adjustment.occurredAt)?.unitCostCents : undefined)
    if (cost === undefined) {
      blockers.push({ code: 'cost_missing', saleKey: adjustment.saleKey, storeId: adjustment.storeId, sku: adjustment.sku })
      continue
    }
    adjustments.push({ saleKey: adjustment.saleKey, kind: adjustment.kind, storeId: adjustment.storeId, sku: adjustment.sku, quantity: adjustment.quantity, unitCostCents: cost, totalCents: adjustment.quantity * cost })
  }

  const reaches = input.salesImportedUntil !== null && input.salesImportedUntil.getTime() >= input.period.end.getTime()
  if (!reaches && !input.partialAccepted) blockers.push({ code: 'sales_incomplete' })

  const lineList = [...lines.values()].sort((a, b) => a.storeId - b.storeId || a.sku.localeCompare(b.sku) || a.costValidFrom.localeCompare(b.costValidFrom))
  const salesCents = lineList.reduce((sum, line) => sum + line.totalCents, 0)
  const adjustmentsCents = adjustments.reduce((sum, adjustment) => sum + adjustment.totalCents, 0)

  return { lines: lineList, cancellations: [...cancelled.values()], adjustments, salesCents, adjustmentsCents, owedCents: salesCents + adjustmentsCents, blockers, confirmable: blockers.length === 0 }
}
