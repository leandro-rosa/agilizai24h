export interface MonthPoint {
  month: string
  /** In force at the end of the month; `null` = none in force (never zero). */
  costCents: number | null
  priceCents: number | null
}

export interface HistoryRow extends MonthPoint {
  /** The product margin `(price - cost) / price`, not the engine's economic margin. `null` when cost or price is missing. */
  margin: number | null
  /** `price / cost`. */
  markup: number | null
  costRose: boolean
  priceChanged: boolean
  marginFell: boolean
  marginImproved: boolean
}

/** Margin changes smaller than this (a hundredth of a point) are noise, not a fall or an improvement. */
const MARGIN_EPSILON = 0.0001

/**
 * One row per month, oldest first, with the cost and price in force at the month's end and flags against the
 * previous month. A month with no cost or no price has an empty margin and markup — the flags that need the
 * missing side stay false instead of guessing.
 */
export function buildHistory(points: MonthPoint[]): HistoryRow[] {
  const rows: HistoryRow[] = []

  for (const point of points) {
    const previous = rows[rows.length - 1]
    const rated = point.costCents !== null && point.costCents > 0 && point.priceCents !== null && point.priceCents > 0
    const margin = rated ? ((point.priceCents as number) - (point.costCents as number)) / (point.priceCents as number) : null
    const markup = rated ? (point.priceCents as number) / (point.costCents as number) : null

    rows.push({
      ...point,
      margin,
      markup,
      costRose: previous?.costCents != null && point.costCents !== null && point.costCents > previous.costCents,
      priceChanged: previous?.priceCents != null && point.priceCents !== null && point.priceCents !== previous.priceCents,
      marginFell: previous?.margin != null && margin !== null && margin < previous.margin - MARGIN_EPSILON,
      marginImproved: previous?.margin != null && margin !== null && margin > previous.margin + MARGIN_EPSILON,
    })
  }

  return rows
}
