import { COST_SOURCE_RANK, type VersionSource } from '../constants/product-vocabulary'

/** The fields every cost or price version has that decide which one is in force. */
export interface Versioned {
  id: number
  effective_from: Date
  source: string
}

/** Lower is stronger. Only used to break a tie between versions with the SAME effective date. */
export type SourceRank = (source: string) => number

export const COST_RANK: SourceRank = source => COST_SOURCE_RANK[source as VersionSource] ?? 2
export const NO_RANK: SourceRank = () => 0

/** Negative when `a` is the version in force over `b`, positive when `b` is. Both are assumed to share an effective date. */
export function compareSameDate(a: Versioned, b: Versioned, rank: SourceRank): number {
  return rank(a.source) - rank(b.source) || b.id - a.id
}

/**
 * The version in force on `asOf`: the latest effective date up to it and, among the versions of that date, the
 * strongest source and then the latest recorded. `null` before the first version — it never falls back to a later
 * one, which would invent a value for a period that has none.
 */
export function resolveVersionAsOf<T extends Versioned>(versions: T[], asOf: Date, rank: SourceRank = NO_RANK): T | null {
  let chosen: T | null = null

  for (const version of versions) {
    if (version.effective_from.getTime() > asOf.getTime()) continue
    if (chosen === null) {
      chosen = version
      continue
    }

    const later = version.effective_from.getTime() - chosen.effective_from.getTime()
    if (later > 0 || (later === 0 && compareSameDate(version, chosen, rank) < 0)) chosen = version
  }

  return chosen
}

/** The version in force today for each product id, from every version of those products. */
export function resolveByProduct<T extends Versioned & { product_id: number }>(versions: T[], asOf: Date, rank: SourceRank = NO_RANK): Map<number, T> {
  const grouped = new Map<number, T[]>()
  for (const version of versions) grouped.set(version.product_id, [...(grouped.get(version.product_id) ?? []), version])

  const result = new Map<number, T>()
  for (const [productId, own] of grouped) {
    const chosen = resolveVersionAsOf(own, asOf, rank)
    if (chosen) result.set(productId, chosen)
  }

  return result
}
