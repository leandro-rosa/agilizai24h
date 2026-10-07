import { compareSameDate, type SourceRank, type Versioned } from './resolve-version'

export interface VersionDescription<T> {
  version: T
  /** Last day the version is in force; `null` when it is the current one or when it is superseded. Derived, never stored. */
  valid_to: string | null
  /** Another version of the same effective date outranks it, so it was never in force. It stays in the history. */
  superseded: boolean
}

const day = (date: Date): string => date.toISOString().slice(0, 10)

function dayBefore(date: Date): string {
  return day(new Date(date.getTime() - 86_400_000))
}

/**
 * Describes a product's whole history, oldest first: for each version, the day it stops being in force (the day before
 * the next effective date) and whether it was superseded by another version of the same date. The end of validity is
 * always derived from the next version, so it can never disagree with the series.
 */
export function describeVersions<T extends Versioned>(versions: T[], rank: SourceRank): VersionDescription<T>[] {
  const byDate = new Map<string, T[]>()
  for (const version of versions) byDate.set(day(version.effective_from), [...(byDate.get(day(version.effective_from)) ?? []), version])

  const dates = [...byDate.keys()].sort()
  const winners = new Map<string, T>()
  for (const [date, own] of byDate) winners.set(date, [...own].sort((a, b) => compareSameDate(a, b, rank))[0])

  const described: VersionDescription<T>[] = []
  for (const date of dates) {
    const next = dates[dates.indexOf(date) + 1]
    const winner = winners.get(date) as T

    for (const version of [...(byDate.get(date) as T[])].sort((a, b) => a.id - b.id)) {
      const inForce = version === winner
      described.push({ version, superseded: !inForce, valid_to: inForce && next ? dayBefore(new Date(`${next}T00:00:00Z`)) : null })
    }
  }

  return described
}

/** The first date the history covers, or `null` when there is none. Shown as "histórico disponível a partir de …". */
export function historyStart<T extends Versioned>(versions: T[]): string | null {
  if (versions.length === 0) return null

  return versions.map(version => day(version.effective_from)).sort()[0]
}
