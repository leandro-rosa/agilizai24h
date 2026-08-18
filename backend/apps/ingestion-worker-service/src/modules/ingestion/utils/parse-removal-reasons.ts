/**
 * Parses the free-text "Removals" field from the restocking report.
 *
 * This is the one piece of parsing with real business consequence. A reported
 * line such as "-6 Devolução, -3 Outro motivo" means six units returned and
 * three removed under another reason — nine units off the shelf, but only
 * three of them a loss. Classifying the line as a whole, in either direction,
 * is the failure the platform exists to prevent, so the split happens here and
 * supply-service only ever receives already-split quantities.
 *
 * Text interpretation lives in the parser rather than in supply-service on
 * purpose: the format belongs to the POS platform and may change, while the
 * loss classification belongs to the business and is stable.
 */

/** Maps the labels as they appear in the reports to the stable reason keys. */
export const REASON_LABEL_TO_KEY: Record<string, string> = {
  'validade vencida': 'expired',
  'produto danificado': 'damaged_product',
  'outro motivo': 'other_reason',
  devolucao: 'return',
  transferencia: 'transfer',
  'uso e consumo': 'internal_use',
}

export interface ParsedReasonQuantity {
  reasonKey: string
  quantity: number
}

export interface ReasonParseSuccess {
  ok: true
  quantities: ParsedReasonQuantity[]
  total: number
}

export interface ReasonParseFailure {
  ok: false
  reason: 'unknown_reason' | 'unparseable' | 'total_mismatch'
  detail: string
}

export type ReasonParseResult = ReasonParseSuccess | ReasonParseFailure

/** Same folding as product names: case, accents, whitespace. */
export function normalizeReasonText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits the field into per-reason quantities.
 *
 * @param text the raw cell, e.g. "-6 Devolução, -3 Outro motivo"
 * @param reportedTotal the row's own removed-quantity column, when it has one.
 *   Supplied so a split that does not add up fails the row rather than being
 *   silently adjusted — supply-service never sees a total, so this is the only
 *   place the two can be checked against each other.
 */
export function parseRemovalReasons(text: string | null | undefined, reportedTotal?: number): ReasonParseResult {
  const raw = (text ?? '').trim()

  // An empty field is not a failure: the row may be a pure restock.
  if (raw === '') return { ok: true, quantities: [], total: 0 }

  // Each segment is a signed quantity followed by a reason label. Splitting on
  // commas and semicolons covers what the reports actually contain; a segment
  // that does not match is reported rather than skipped.
  const segments = raw
    .split(/[;,]/)
    .map(segment => segment.trim())
    .filter(segment => segment !== '')

  const quantities: ParsedReasonQuantity[] = []

  for (const segment of segments) {
    const match = segment.match(/^-?\s*(\d+)\s+(.+)$/)

    if (!match) {
      return { ok: false, reason: 'unparseable', detail: `Could not read quantity and reason from "${segment}"` }
    }

    const quantity = Number(match[1])
    const label = normalizeReasonText(match[2])
    const reasonKey = REASON_LABEL_TO_KEY[label]

    if (!reasonKey) {
      // Never guessed into a bucket: defaulting to loss inflates the figure the
      // business is reducing, defaulting to non-loss deletes real loss.
      return { ok: false, reason: 'unknown_reason', detail: `Unknown removal reason "${match[2].trim()}"` }
    }

    quantities.push({ reasonKey, quantity })
  }

  // Segments naming the same reason twice are merged rather than duplicated,
  // since the sink's grain is one row per (store, period, SKU, reason).
  const merged = new Map<string, number>()
  for (const entry of quantities) {
    merged.set(entry.reasonKey, (merged.get(entry.reasonKey) ?? 0) + entry.quantity)
  }

  const result = [...merged.entries()].map(([reasonKey, quantity]) => ({ reasonKey, quantity }))
  const total = result.reduce((sum, entry) => sum + entry.quantity, 0)

  if (reportedTotal !== undefined && Math.abs(reportedTotal) !== total) {
    return {
      ok: false,
      reason: 'total_mismatch',
      detail: `Split sums to ${total} but the row reports ${Math.abs(reportedTotal)} removed`,
    }
  }

  return { ok: true, quantities: result, total }
}
