import type { Parameters } from '../parameters/parameters.types'
import type { CompareTo, Figure, Movement, SituationLabel, StoreRow, UnavailableReason, Variation } from './analysis.types'
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
  'bonusUnits',
  'restocked',
  'sold',
  'lost',
  'revenueCents',
  'lossCents',
  'marginShare',
  'avgCostCents',
  'avgPriceCents',
  'grossProfitCents',
  'markup',
  'costCoverage',
]

const ok = (value: number, partial = false, estimated = false): Figure => ({ available: true, value, ...(partial ? { partial: true } : {}), ...(estimated ? { estimated: true } : {}) })

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

/** One month's worth of inputs to a movement; a range is several of these summed. */
export interface MovementPart {
  facts: MonthFacts
  /** Unit cost as of that month, or null when none was resolved. */
  cost: (sku: string) => number | null
  purchases: Map<string, PurchaseMonth> | null
  /** The losses in these facts are allocated from a month's total (a day window), not recorded. */
  lossEstimated?: boolean
}

/** `cost(sku)` is the unit cost as of the month, or null when none was resolved. */
export function movementOf(
  facts: MonthFacts,
  skus: Set<string>,
  cost: (sku: string) => number | null,
  purchases: Map<string, PurchaseMonth> | null,
  storeId?: number,
): Movement {
  return movementOfParts([{ facts, cost, purchases }], skus, storeId)
}

/**
 * The movement over one or more months. Quantities and money add up month by
 * month, each month valued at its own cost; a month whose supply (or sales) was
 * never ingested for every store contributes nothing and makes the total partial,
 * and only when no month has data is the figure unavailable.
 */
export function movementOfParts(parts: MovementPart[], skus: Set<string>, storeId?: number): Movement {
  let restocked = 0
  let lost = 0
  let sold = 0
  let revenue = 0
  let supplyUsed = 0
  let salesUsed = 0
  let supplyPartial = false
  let salesPartial = false

  let lossCents = 0
  let lossMissingCost = false
  let anyLoss = false
  let costOfSold = 0
  let soldWithCost = 0
  let revenueWithCost = 0
  let soldWithoutCost = false

  let lossEstimated = false

  let bonusRevenue = 0
  let bonusSold = false

  for (const { facts, cost, lossEstimated: estimatedPart, purchases } of parts) {
    if (estimatedPart) lossEstimated = true
    // A SKU received only as a bonus in the month has no real cost: it stays out of margin, markup and profit (and says why).
    const bonusOnly = new Set([...(purchases ?? [])].filter(([sku, p]) => skus.has(sku) && p.bonusUnits > 0 && p.units === 0).map(([sku]) => sku))
    const bySku = sumCells(facts, skus, storeId)
    const supplyGap = facts.storesMissingSupply.length > 0 && (storeId === undefined || facts.storesMissingSupply.includes(storeId))
    const salesGap = facts.storesMissingSales.length > 0 && (storeId === undefined || facts.storesMissingSales.includes(storeId))
    const everySupplyMissing = storeId !== undefined ? facts.storesMissingSupply.includes(storeId) : facts.storesMissingSupply.length >= facts.storeCount
    const everySalesMissing = storeId !== undefined ? facts.storesMissingSales.includes(storeId) : facts.storesMissingSales.length >= facts.storeCount

    if (everySupplyMissing) supplyPartial = true
    else {
      supplyUsed++
      if (supplyGap) supplyPartial = true
      for (const [sku, cell] of bySku) {
        restocked += cell.restocked
        lost += cell.lost
        if (cell.lost > 0) {
          anyLoss = true
          const unit = cost(sku)
          if (unit === null) lossMissingCost = true
          else lossCents += cell.lost * unit
        }
      }
    }

    if (everySalesMissing) salesPartial = true
    else {
      salesUsed++
      if (salesGap) salesPartial = true
      for (const [sku, cell] of bySku) {
        sold += cell.sold
        revenue += cell.revenueCents
        if (bonusOnly.has(sku)) {
          bonusRevenue += cell.revenueCents
          if (cell.sold > 0) bonusSold = true
          continue
        }
        if (cell.sold > 0) {
          const unit = cost(sku)
          if (unit === null) soldWithoutCost = true
          else {
            costOfSold += cell.sold * unit
            soldWithCost += cell.sold
            revenueWithCost += cell.revenueCents
          }
        }
      }
    }
  }

  const neverSupply: Figure = { available: false, reason: 'never_ingested' }
  const lossValue: Figure =
    supplyUsed === 0 ? neverSupply : anyLoss && lossMissingCost && lossCents === 0 ? { available: false, reason: 'no_cost' } : ok(lossCents, supplyPartial || lossMissingCost, lossEstimated)

  const noCostReason: UnavailableReason = soldWithoutCost ? 'no_cost' : bonusSold ? 'bonus' : 'no_base'
  const marginShare: Figure =
    salesUsed === 0
      ? { available: false, reason: 'never_ingested' }
      : revenueWithCost <= 0
        ? { available: false, reason: noCostReason }
        : ok((revenueWithCost - costOfSold) / revenueWithCost, salesPartial || soldWithoutCost)

  const profitPartial = salesPartial || soldWithoutCost
  const grossProfit: Figure = salesUsed === 0 ? { available: false, reason: 'never_ingested' } : revenueWithCost <= 0 ? { available: false, reason: noCostReason } : ok(revenueWithCost - costOfSold, profitPartial)
  const markup: Figure = salesUsed === 0 ? { available: false, reason: 'never_ingested' } : costOfSold <= 0 ? { available: false, reason: noCostReason } : ok(revenueWithCost / costOfSold, profitPartial)
  const costBasis = revenue - bonusRevenue
  const costCoverage: Figure = salesUsed === 0 ? { available: false, reason: 'never_ingested' } : costBasis <= 0 ? { available: false, reason: bonusSold ? 'bonus' : 'no_base' } : ok(revenueWithCost / costBasis, salesPartial)
  const avgPrice: Figure = salesUsed === 0 ? { available: false, reason: 'never_ingested' } : sold <= 0 ? { available: false, reason: 'no_base' } : ok(revenue / sold, salesPartial)

  const avgCost: Figure = soldWithCost > 0 ? ok(costOfSold / soldWithCost, soldWithoutCost) : { available: false, reason: noCostReason }

  // Purchases are bought for the network, not per store: under a store filter they cannot be attributed.
  const withPurchases = parts.filter(part => part.purchases !== null)
  const sumPurchases = (pick: (p: PurchaseMonth) => number): Figure => {
    if (storeId !== undefined) return { available: false, reason: 'no_base' }
    if (withPurchases.length === 0) return NO_PURCHASE_HISTORY

    const total = withPurchases.reduce((sum, part) => sum + [...part.purchases!].filter(([sku]) => skus.has(sku)).reduce((s, [, p]) => s + pick(p), 0), 0)

    return ok(total, withPurchases.length < parts.length)
  }

  return {
    purchasedUnits: sumPurchases(p => p.units),
    purchasedCents: sumPurchases(p => p.cents),
    bonusUnits: sumPurchases(p => p.bonusUnits),
    restocked: supplyUsed === 0 ? neverSupply : ok(restocked, supplyPartial),
    sold: salesUsed === 0 ? { available: false, reason: 'never_ingested' } : ok(sold, salesPartial),
    lost: supplyUsed === 0 ? neverSupply : ok(lost, supplyPartial, lossEstimated),
    revenueCents: salesUsed === 0 ? { available: false, reason: 'never_ingested' } : ok(revenue, salesPartial),
    lossCents: lossValue,
    marginShare,
    avgCostCents: avgCost,
    avgPriceCents: avgPrice,
    grossProfitCents: grossProfit,
    markup,
    costCoverage,
  }
}

/** Sums the cells of several months into one, for per-store and network ratios over a range. Missing lists are the stores missing in every month. */
export function mergeFacts(all: MonthFacts[]): MonthFacts {
  const cells = new Map<number, Map<string, Cell>>()
  for (const facts of all)
    for (const [store, bySku] of facts.cells) {
      const target = cells.get(store) ?? new Map<string, Cell>()
      for (const [sku, cell] of bySku) {
        const acc = target.get(sku) ?? { restocked: 0, sold: 0, lost: 0, revenueCents: 0 }
        acc.restocked += cell.restocked
        acc.sold += cell.sold
        acc.lost += cell.lost
        acc.revenueCents += cell.revenueCents
        target.set(sku, acc)
      }
      cells.set(store, target)
    }

  const missingInAll = (pick: (f: MonthFacts) => number[]): number[] => (all.length === 0 ? [] : pick(all[0]).filter(id => all.every(f => pick(f).includes(id))))

  return {
    month: all.length > 0 ? `${all[0].month}..${all[all.length - 1].month}` : '',
    cells,
    storesMissingSupply: missingInAll(f => f.storesMissingSupply),
    storesMissingSales: missingInAll(f => f.storesMissingSales),
    storeCount: all[0]?.storeCount ?? 0,
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
