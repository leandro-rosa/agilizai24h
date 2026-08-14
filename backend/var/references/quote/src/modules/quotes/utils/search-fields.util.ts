import { MATCHABLE_TARGET_FIELDS, ScoredSearchField } from './candidate-scoring.util'

export interface OriginalFieldLike {
  key: string
  value: string
}

/**
 * Fixed weighting for partner-API-submitted fields, since there's no
 * column-mapping template (no spreadsheet, no per-quote priority
 * configuration) to derive it from the way MatchItemWorker does for
 * spreadsheet rows — exact-code fields outrank fuzzy text fields, mirrored
 * from QuoteProductsService.search()'s own field weighting.
 */
const CANONICAL_FIELD_PRIORITY: Record<string, number> = {
  sku: 0,
  ean: 0,
  main_code: 1,
  oem: 2,
  trade_number: 2,
  name: 5,
  brand: 6,
}

/**
 * Converts a partner-API line's raw `originalFields` (key/value pairs
 * whose `key` is expected to be one of the canonical vocabulary target
 * fields) into the `{targetField, value, priority}` shape
 * `candidate-scoring.util.ts`'s `scoreCandidate()` and the
 * quote<->search matching queues both use. Fields with an unrecognized
 * key or an empty value are dropped, not passed through as noise.
 */
export function toSearchFields(originalFields: OriginalFieldLike[]): ScoredSearchField[] {
  return (originalFields ?? [])
    .filter(field => MATCHABLE_TARGET_FIELDS.includes(field.key) && field.value?.trim())
    .map(field => ({
      targetField: field.key,
      value: field.value.trim(),
      priority: CANONICAL_FIELD_PRIORITY[field.key] ?? 5,
    }))
}

export function toNormalizedSearchData(fields: ScoredSearchField[]): Record<string, string | string[]> {
  const normalizedData: Record<string, string | string[]> = {}
  for (const field of fields) {
    const currentValue = normalizedData[field.targetField]
    if (currentValue === undefined) {
      normalizedData[field.targetField] = field.value
    } else if (Array.isArray(currentValue)) {
      currentValue.push(field.value)
    } else {
      normalizedData[field.targetField] = [currentValue, field.value]
    }
  }
  return normalizedData
}
