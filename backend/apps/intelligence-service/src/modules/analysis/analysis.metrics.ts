import type { Parameters } from '../parameters/parameters.types'
import type { CompareTo, Figure, Movement, SituationLabel, StoreRow, Variation } from './analysis.types'
import { NO_PURCHASE_HISTORY, type PurchaseMonth } from './purchase-source'

/** One store's figures for one SKU in one month. */
export interface Cell {
  restocked: number
  sold: number
  lost: number
  revenueCents: number
}

/**
 * Everything read for one month. A store whose supply or sales for the month was
 * never ingested is listed as missing — it is not a store with zeroes.
 */
export interface MonthFacts {
  month: string
  cells: Map<number, Map<string, Cell>>
  storesMissingSupply: number[]
  storesMissingSales: number[]
  storeCount: number
}

export const MOVEMENT_KEYS: (keyof Movement)[] = [
  'purchasedUnits',
  'purchasedCents',
  'restocked',
  'sold',
  'lost',
  'revenueCents',
  'lossCents',
  'marginShare',
  'avgCostCents',
]

const ok = (value: number, partial = false): Figure => (partial ? { available: true, value, partial: true } : { available: true, value })

/** Sum of the cells of the SKUs in `skus`, optionally for a single store. */
function sumCells(facts: MonthFacts, skus: Set<string>, storeId?: number) {
  const bySku = new Map<string, Cell>()

  for (const [store, cells] of facts.cells) {
    if (storeId !== undefined && store !== storeId) continue
    for (const [sku, cell] of cells) {
      if (!skus.has(sku)) continue
      const acc = bySku.get(sku) ?? { restocked: 0, sold: 0, lost: 0, revenueCents: 0 }
      acc.restocked += cell.restocked
      acc.sold += cell.sold
      acc.lost += cell.lost
      acc.revenueCents += cell.revenueCents
      bySku.set(sku, acc)
    }
  }

  return bySku
}

/** `cost(sku)` is the unit cost as of the month, or null when none was resolved. */
export function movementOf(
  facts: MonthFacts,
  skus: Set<string>,
  cost: (sku: string) => number | null,
  purchases: Map<string, PurchaseMonth> | null,
  storeId?: number,
): Movement {
  const bySku = sumCells(facts, skus, storeId)
  const supplyGap = facts.storesMissingSupply.length > 0 && (storeId === undefined || facts.storesMissingSupply.includes(storeId))
  const salesGap = facts.storesMissingSales.length > 0 && (storeId === undefined || facts.storesMissingSales.includes(storeId))
  const everySupplyMissing = storeId !== undefined ? facts.storesMissingSupply.includes(storeId) : facts.storesMissingSupply.length >= facts.storeCount
  const everySalesMissing = storeId !== undefined ? facts.storesMissingSales.includes(storeId) : facts.storesMissingSales.length >= facts.storeCount

  const fromSupply = (pick: (cell: Cell) => number): Figure =>
    everySupplyMissing ? { available: false, reason: 'never_ingested' } : ok([...bySku.values()].reduce((s, c) => s + pick(c), 0), supplyGap)
  const fromSales = (pick: (cell: Cell) => number): Figure =>
    everySalesMissing ? { available: false, reason: 'never_ingested' } : ok([...bySku.values()].reduce((s, c) => s + pick(c), 0), salesGap)

  let lossCents = 0
  let lossMissingCost = false
  let costOfSold = 0
  let soldWithCost = 0
  let revenueWithCost = 0
  let soldWithoutCost = false

  for (const [sku, cell] of bySku) {
    const unit = cost(sku)
    if (cell.lost > 0) {
      if (unit === null) lossMissingCost = true
      else lossCents += cell.lost * unit
    }
    if (cell.sold > 0) {
      if (unit === null) soldWithoutCost = true
      else {
        costOfSold += cell.sold * unit
        soldWithCost += cell.sold
        revenueWithCost += cell.revenueCents
      }
    }
  }

  const anyLoss = [...bySku.values()].some(c => c.lost > 0)
  const lossValue: Figure = everySupplyMissing
    ? { available: false, reason: 'never_ingested' }
    : anyLoss && lossMissingCost && lossCents === 0
      ? { available: false, reason: 'no_cost' }
      : ok(lossCents, supplyGap || lossMissingCost)

  const marginShare: Figure = everySalesMissing
    ? { available: false, reason: 'never_ingested' }
    : revenueWithCost <= 0
      ? { available: false, reason: soldWithoutCost ? 'no_cost' : 'no_base' }
      : ok((revenueWithCost - costOfSold) / revenueWithCost, salesGap || soldWithoutCost)

  const avgCost: Figure = soldWithCost > 0 ? ok(costOfSold / soldWithCost, soldWithoutCost) : { available: false, reason: soldWithoutCost ? 'no_cost' : 'no_base' }

  // Purchases are bought for the network, not per store: under a store filter they cannot be attributed.
  const purchasedUnits: Figure = storeId !== undefined ? { available: false, reason: 'no_base' } : purchases ? ok([...purchases].filter(([sku]) => skus.has(sku)).reduce((s, [, p]) => s + p.units, 0)) : NO_PURCHASE_HISTORY
  const purchasedCents: Figure = storeId !== undefined ? { available: false, reason: 'no_base' } : purchases ? ok([...purchases].filter(([sku]) => skus.has(sku)).reduce((s, [, p]) => s + p.cents, 0)) : NO_PURCHASE_HISTORY

  return {
    purchasedUnits,
    purchasedCents,
    restocked: fromSupply(c => c.restocked),
    sold: fromSales(c => c.sold),
    lost: fromSupply(c => c.lost),
    revenueCents: fromSales(c => c.revenueCents),
    lossCents: lossValue,
    marginShare,
    avgCostCents: avgCost,
  }
}

/** Compares a figure with a reference figure. A zero or missing reference gives no percentage, never infinity. */
export function variationOf(current: Figure, reference: Figure): Variation {
  if (!current.available) return { reference, change: current }
  if (!reference.available) return { reference, change: reference }
  if (reference.value === 0) return { reference, change: { available: false, reason: 'no_base' } }

  return {
    reference,
    change: ok((current.value - reference.value) / Math.abs(reference.value), current.partial === true || reference.partial === true),
  }
}

/** The reference of a figure over earlier months: the previous month, or the mean of the (up to) 3 months before. */
export function referenceOf(history: Figure[], compareTo: CompareTo): Figure {
  if (compareTo === 'prev_month') return history[history.length - 1] ?? { available: false, reason: 'no_base' }

  const recent = history.slice(-3)
  const usable = recent.filter((f): f is Extract<Figure, { available: true }> => f.available)
  if (usable.length === 0) return recent.find(f => !f.available) ?? { available: false, reason: 'no_base' }

  const mean = usable.reduce((s, f) => s + f.value, 0) / usable.length

  return ok(mean, usable.length < 3 || usable.some(f => f.partial))
}

/** `earlier` is oldest → newest, ending the month before `current`. */
export function compareMovements(current: Movement, earlier: Movement[], compareTo: CompareTo): Record<keyof Movement, Variation> {
  const out = {} as Record<keyof Movement, Variation>
  for (const key of MOVEMENT_KEYS) {
    out[key] = variationOf(
      current[key],
      referenceOf(
        earlier.map(m => m[key]),
        compareTo,
      ),
    )
  }

  return out
}

/** Situation of a store for a product. Null (never "good") when there is too little restocked to rate. */
export function situationOf(restocked: number, sold: number, lost: number, p: Parameters['analysis']): { situation: SituationLabel | null; reason?: 'below_min_restocked' } {
  if (restocked < p.minRestockedForSituation || restocked <= 0) return { situation: null, reason: 'below_min_restocked' }

  const sellThrough = sold / restocked
  const lossShare = lost / restocked

  if (sellThrough < p.criticalSellThrough) return { situation: 'critical' }
  if (sellThrough >= p.goodSellThrough && lossShare < p.attentionLossShare) return { situation: 'good' }

  return { situation: 'attention' }
}

export function storeRows(
  facts: MonthFacts,
  skus: Set<string>,
  storeNames: Map<number, string>,
  p: Parameters['analysis'],
): StoreRow[] {
  const rows: StoreRow[] = []

  for (const [storeId] of facts.cells) {
    const totals = sumCells(facts, skus, storeId)
    if (totals.size === 0) continue
    const restocked = [...totals.values()].reduce((s, c) => s + c.restocked, 0)
    const sold = [...totals.values()].reduce((s, c) => s + c.sold, 0)
    const lost = [...totals.values()].reduce((s, c) => s + c.lost, 0)
    if (restocked === 0 && sold === 0 && lost === 0) continue
    const verdict = situationOf(restocked, sold, lost, p)

    rows.push({
      storeId,
      storeName: storeNames.get(storeId) ?? null,
      restocked,
      sold,
      lost,
      sellThrough: restocked > 0 ? sold / restocked : null,
      situation: verdict.situation,
      ...(verdict.reason ? { situationReason: verdict.reason } : {}),
    })
  }

  // Worst performers first: that is where the owner's decision is.
  return rows.sort((a, b) => (a.sellThrough ?? Infinity) - (b.sellThrough ?? Infinity))
}
