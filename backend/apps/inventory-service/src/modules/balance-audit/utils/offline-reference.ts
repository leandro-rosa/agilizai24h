/**
 * Figures from the offline analysis of 2026-09-30 (raw Abastecimentos workbooks,
 * Jan–Aug 2026), kept as DOCUMENTED REFERENCE VALUES for the backfill check in
 * `add-stock-quality-phase0` task 7.3 — what the live audit is compared against
 * to explain any difference.
 *
 * They are not thresholds and nothing reads them at runtime: the audit sets no
 * tolerance. They describe what was measured once, on a snapshot of the files.
 */
export const OFFLINE_REFERENCE = {
  measuredOn: '2026-09-30',
  /** Visit lines that belong to a store (have a `Cliente`). */
  linesWithStore: 88_418,
  /** Of those, lines carrying a confirmed count. */
  countedLines: 25_606,
  /** Share of counted lines whose count equals the system balance before the visit. */
  shareCountEqualsSystem: 0.97,
  /** Store × SKU × month combinations compared for consumption against sales. */
  comparedStoreSkuMonths: 10_080,
  /** Operations with no `Cliente` (the distribution center's inventory). */
  operationsWithoutClient: 152,
  linesWithoutClient: 28_610,
} as const
