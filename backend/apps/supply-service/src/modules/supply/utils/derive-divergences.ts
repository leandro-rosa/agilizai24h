/** A stock-divergence occurrence: units of one reason removed from a SKU in the visit that reported them. */
export interface VisitLineFact {
  storeId: number
  sku: string
  visitId: number
  kind: string
  period: string
  sourceReference: string
  /** The report's own end instant (wall-clock stored in UTC fields, no conversion). */
  endedAt: Date
  /** The count made BEFORE restocking; null = not counted (never zero). */
  confirmedCount: number | null
  /** Signed total removed on the line. */
  removedTotal: number
  /** Removals of the line per reason key; null = the line was ingested before the split was kept (unknown, not zero). */
  removalsByReason: Record<string, number> | null
}

export interface Divergence {
  storeId: number
  sku: string
  quantity: number
  /** The visit that reported the units. */
  identifiedAt: Date
  identifiedKind: string
  identifiedVisitId: number
  identifiedReference: string
  /** The latest earlier visit in which this SKU was counted in this store; null when there is none. */
  previousConferenceAt: Date | null
  previousConferenceKind: string | null
  previousConferenceVisitId: number | null
  previousConferenceReference: string | null
}

export interface DivergenceResult {
  divergences: Divergence[]
  /** Visits inside the range that removed units but whose reasons were never stored: their loss cannot be dated until the month is re-imported. */
  unsplitVisits: number
}

const keyOf = (line: VisitLineFact) => `${line.storeId}|${line.sku}|${line.endedAt.getTime()}`

/**
 * Keeps one fact per (store, SKU, end instant): the same operation present in two ingested periods, or re-imported, is
 * one occurrence. The highest visit id (the latest write) wins.
 */
function dedupe(lines: VisitLineFact[]): VisitLineFact[] {
  const byKey = new Map<string, VisitLineFact>()
  for (const line of lines) {
    const kept = byKey.get(keyOf(line))
    if (!kept || line.visitId > kept.visitId) byKey.set(keyOf(line), line)
  }

  return [...byKey.values()]
}

/**
 * The occurrences of one removal reason over a range of end instants.
 *
 * - The quantity is the reason's own split on the line — never the line's whole removal, never a monthly total spread
 *   over visits.
 * - The occurrence is dated by the visit that reported it (`identifiedAt`), and the previous conferência is the latest
 *   EARLIER visit where the same SKU of the same store was counted (`confirmedCount` not null). A restock with no
 *   count is not a conferência, and the visit's own "previous operation" instant is never used: it is per operation,
 *   not per product.
 * - A product with losses in different visits yields separate rows; none is merged.
 *
 * `lines` must hold every reporting line in the range plus the counted lines before it; lines of other stores or
 * SKUs are harmless.
 */
export function deriveDivergences(lines: VisitLineFact[], reasonKey: string, from: Date, to: Date): DivergenceResult {
  const facts = dedupe(lines)

  const counted = new Map<string, VisitLineFact[]>()
  for (const line of facts) {
    if (line.confirmedCount === null) continue
    const key = `${line.storeId}|${line.sku}`
    if (!counted.has(key)) counted.set(key, [])
    counted.get(key)!.push(line)
  }

  const inRange = facts.filter(line => line.endedAt >= from && line.endedAt <= to)
  const unsplit = new Set<string>()
  const divergences: Divergence[] = []

  for (const line of inRange) {
    if (line.removalsByReason === null) {
      if (line.removedTotal < 0) unsplit.add(`${line.storeId}|${line.endedAt.getTime()}`)
      continue
    }

    const quantity = line.removalsByReason[reasonKey] ?? 0
    if (quantity <= 0) continue

    let previous: VisitLineFact | null = null
    for (const candidate of counted.get(`${line.storeId}|${line.sku}`) ?? []) {
      if (candidate.endedAt >= line.endedAt) continue
      if (previous === null || candidate.endedAt > previous.endedAt) previous = candidate
    }

    divergences.push({
      storeId: line.storeId,
      sku: line.sku,
      quantity,
      identifiedAt: line.endedAt,
      identifiedKind: line.kind,
      identifiedVisitId: line.visitId,
      identifiedReference: line.sourceReference,
      previousConferenceAt: previous?.endedAt ?? null,
      previousConferenceKind: previous?.kind ?? null,
      previousConferenceVisitId: previous?.visitId ?? null,
      previousConferenceReference: previous?.sourceReference ?? null,
    })
  }

  divergences.sort((a, b) => a.identifiedAt.getTime() - b.identifiedAt.getTime() || a.sku.localeCompare(b.sku) || a.storeId - b.storeId)

  return { divergences, unsplitVisits: unsplit.size }
}
