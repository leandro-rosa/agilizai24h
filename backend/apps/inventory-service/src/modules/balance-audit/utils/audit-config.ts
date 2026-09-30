import type { AuditBands } from './audit-types'
import { DEFAULT_BANDS } from './bands'

type Lookup = { get(key: string): unknown }

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return value !== undefined && value !== null && value !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * The bands come from backend configuration — never from the browser — so the
 * slicing of the distributions has one home. Every value is PROVISIONAL:
 * presentation cut points chosen to show whether divergence depends on how fast
 * a SKU turns, not thresholds of acceptability. Env names:
 * `AUDIT_TURNOVER_HIGH_MIN`, `AUDIT_TURNOVER_MEDIUM_MIN` (monthly units),
 * `AUDIT_BALANCE_UPPER_BOUNDS` (comma-separated, ascending, starting at 0).
 */
export function readAuditBands(config: Lookup): AuditBands {
  const highMin = positiveNumber(config.get('AUDIT_TURNOVER_HIGH_MIN'), DEFAULT_BANDS.turnover.highMin)
  const mediumMin = positiveNumber(config.get('AUDIT_TURNOVER_MEDIUM_MIN'), DEFAULT_BANDS.turnover.mediumMin)

  const raw = config.get('AUDIT_BALANCE_UPPER_BOUNDS')
  const parsed =
    typeof raw === 'string' && raw.trim() !== '' ? raw.split(',').map(part => Number(part.trim())) : DEFAULT_BANDS.balanceUpperBounds
  const ascending = parsed.every((value, index) => Number.isFinite(value) && value >= 0 && (index === 0 || value > parsed[index - 1]))

  return {
    // An inverted pair would make 'medium' unreachable; fall back rather than report a nonsense band.
    turnover: mediumMin < highMin ? { highMin, mediumMin } : DEFAULT_BANDS.turnover,
    balanceUpperBounds: ascending && parsed.length > 0 ? parsed : DEFAULT_BANDS.balanceUpperBounds,
  }
}
