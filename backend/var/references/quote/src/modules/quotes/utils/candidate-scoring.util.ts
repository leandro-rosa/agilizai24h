import { ProductCatalogDocument } from '../../product-catalog-seed/product-catalog-document'

export type MatchableTargetField = 'sku' | 'ean' | 'main_code' | 'oem' | 'trade_number' | 'name' | 'brand'
export const MATCHABLE_TARGET_FIELDS: readonly string[] = [
  'sku',
  'ean',
  'main_code',
  'oem',
  'trade_number',
  'name',
  'brand',
]

export interface ScoredSearchField {
  targetField: string
  value: string
  priority: number
}

export interface CandidateScoringOptions {
  fieldWeights?: Partial<Record<MatchableTargetField, number>>
  synonymGroups?: readonly {
    field: MatchableTargetField
    terms: readonly string[]
  }[]
  evidence?: readonly {
    targetField: string
    kind: 'exact' | 'text' | 'synonym' | 'fuzzy'
    searchFieldIndex?: number
  }[]
  /** Legacy v1 evidence has no kind; treat labels as exact-only evidence. */
  evidenceLabels?: readonly string[]
}

const EXACT_FIELD_MAP: Record<string, keyof ProductCatalogDocument> = {
  sku: 'sku',
  ean: 'ean',
  main_code: 'mainCode',
}
const ARRAY_FIELD_MAP: Record<string, keyof ProductCatalogDocument> = {
  oem: 'oemCodes',
  trade_number: 'tradeNumbers',
}
const FUZZY_FIELD_MAP: Record<string, keyof ProductCatalogDocument> = {
  name: 'name',
  brand: 'brand',
}

const FIELD_LABEL: Record<MatchableTargetField, string> = {
  sku: 'SKU',
  ean: 'EAN',
  main_code: 'Código principal',
  oem: 'OEM',
  trade_number: 'Trade Number',
  name: 'Nome',
  brand: 'Marca',
}
const TOKEN_STOP_WORDS = new Set([
  'a',
  'as',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'para',
  'sem',
])
const MAX_SCORING_WEIGHT = Number.MAX_SAFE_INTEGER

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(token => token && !TOKEN_STOP_WORDS.has(token)))
  const rightTokens = new Set(right.split(' ').filter(token => token && !TOKEN_STOP_WORDS.has(token)))
  const union = new Set([...leftTokens, ...rightTokens])
  if (union.size === 0) return 0

  let intersectionSize = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersectionSize += 1
  }
  return intersectionSize / union.size
}

function isConfiguredSynonym(
  targetField: MatchableTargetField,
  left: string,
  right: string,
  synonymGroups: CandidateScoringOptions['synonymGroups'],
): boolean {
  if (left === right) return false

  return (synonymGroups ?? []).some(group => {
    if (group.field !== targetField) return false
    const normalizedTerms = new Set(group.terms.map(normalize).filter(Boolean))
    return normalizedTerms.has(left) && normalizedTerms.has(right)
  })
}

function characterSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      const substitution = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      previous[rightIndex] = Math.min(previous[rightIndex] + 1, previous[rightIndex - 1] + 1, substitution)
      diagonal = above
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length)
}

function fieldWeight(targetField: MatchableTargetField, priority: number, options: CandidateScoringOptions): number {
  const priorityWeight = 10 - priority
  const defaultWeight = Number.isFinite(priorityWeight)
    ? Math.min(MAX_SCORING_WEIGHT, Math.max(1, priorityWeight))
    : 1
  const configuredWeight = options.fieldWeights?.[targetField]
  if (configuredWeight === undefined || !Number.isFinite(configuredWeight)) return defaultWeight
  return Math.min(MAX_SCORING_WEIGHT, Math.max(0, configuredWeight))
}

function isMatchableTargetField(targetField: string): targetField is MatchableTargetField {
  return MATCHABLE_TARGET_FIELDS.some(field => field === targetField)
}

/**
 * Scores one candidate against the row's mapped/normalized search fields.
 * Only ever reports a reason for a field that actually matched — never
 * invents a match reason, per the brief ("a interface não deve inventar o
 * motivo do match").
 */
export function scoreCandidate(
  fields: ScoredSearchField[],
  candidate: ProductCatalogDocument,
  options: CandidateScoringOptions = {},
): { score: number; reasons: string[] } {
  let totalWeight = 0
  let matchedWeight = 0
  const reasons: string[] = []
  const evidenceByField = new Map<MatchableTargetField, Set<'exact' | 'text' | 'synonym' | 'fuzzy'>>()
  const evidenceByIndex = new Map<number, Set<'exact' | 'text' | 'synonym' | 'fuzzy'>>()
  for (const evidence of options.evidence ?? []) {
    if (!isMatchableTargetField(evidence.targetField)) continue
    if (Number.isInteger(evidence.searchFieldIndex) && (evidence.searchFieldIndex as number) >= 0) {
      const kinds = evidenceByIndex.get(evidence.searchFieldIndex as number) ?? new Set()
      kinds.add(evidence.kind)
      evidenceByIndex.set(evidence.searchFieldIndex as number, kinds)
      continue
    }
    const kinds = evidenceByField.get(evidence.targetField) ?? new Set()
    kinds.add(evidence.kind)
    evidenceByField.set(evidence.targetField, kinds)
  }
  for (const targetField of options.evidenceLabels?.filter(isMatchableTargetField) ?? []) {
    const kinds = evidenceByField.get(targetField) ?? new Set()
    kinds.add('exact')
    evidenceByField.set(targetField, kinds)
  }

  for (const [searchFieldIndex, { targetField, value, priority }] of fields.entries()) {
    if (!isMatchableTargetField(targetField)) continue

    const normalizedValue = normalize(value ?? '')
    if (!normalizedValue) continue

    const weight = fieldWeight(targetField, priority, options)
    const evidenceKinds = evidenceByIndex.get(searchFieldIndex) ?? evidenceByField.get(targetField) ?? new Set()
    totalWeight += weight
    if (weight === 0) continue

    if (EXACT_FIELD_MAP[targetField]) {
      const candidateValue = normalize(String(candidate[EXACT_FIELD_MAP[targetField]] ?? ''))
      if (candidateValue && candidateValue === normalizedValue) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} idêntico`)
      } else if (evidenceKinds.has('synonym')) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} por sinônimo configurado`)
      } else if (evidenceKinds.has('exact')) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} confirmado por evidência`)
      }
    } else if (ARRAY_FIELD_MAP[targetField]) {
      const candidateValues = (candidate[ARRAY_FIELD_MAP[targetField]] as string[]) ?? []
      if (candidateValues.some(candidateValue => normalize(candidateValue) === normalizedValue)) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} correspondente`)
      } else if (evidenceKinds.has('synonym')) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} por sinônimo configurado`)
      } else if (evidenceKinds.has('exact')) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} confirmado por evidência`)
      }
    } else if (FUZZY_FIELD_MAP[targetField]) {
      const candidateValue = normalize(String(candidate[FUZZY_FIELD_MAP[targetField]] ?? ''))
      if (candidateValue === normalizedValue) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} ${targetField === 'brand' ? 'idêntica' : 'idêntico'}`)
      } else if (isConfiguredSynonym(targetField, normalizedValue, candidateValue, options.synonymGroups)) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} por sinônimo configurado`)
      } else if (evidenceKinds.has('synonym')) {
        matchedWeight += weight
        reasons.push(`${FIELD_LABEL[targetField]} por sinônimo configurado`)
      } else {
        const similarity = tokenSimilarity(normalizedValue, candidateValue)
        if (similarity > 0) {
          matchedWeight += weight * similarity
          reasons.push(`${FIELD_LABEL[targetField]} semelhante (${Math.round(similarity * 100)}% dos tokens)`)
        } else if (evidenceKinds.has('fuzzy')) {
          const fuzzySimilarity = characterSimilarity(normalizedValue, candidateValue)
          if (fuzzySimilarity > 0) {
            matchedWeight += weight * fuzzySimilarity
            reasons.push(`${FIELD_LABEL[targetField]} semelhante (${Math.round(fuzzySimilarity * 100)}% dos caracteres)`)
          }
        }
      }
    }
  }

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0
  return { score: Math.max(0, Math.min(100, score)), reasons }
}
