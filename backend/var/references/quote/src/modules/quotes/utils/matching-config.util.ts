export const MATCHING_CONFIG_VERSION = 1 as const
export const CANONICAL_MATCHING_FIELDS = ['sku', 'ean', 'main_code', 'oem', 'trade_number', 'name', 'brand'] as const
export const MAX_SYNONYM_GROUPS = 20
export const MAX_SYNONYM_TERMS = 10
export const MAX_SYNONYM_TERM_LENGTH = 80

export type CanonicalMatchingField = (typeof CANONICAL_MATCHING_FIELDS)[number]
export type MatchingPrecision = 'strict' | 'balanced' | 'broad'

export interface MatchingFieldWeights {
  sku: number
  ean: number
  main_code: number
  oem: number
  trade_number: number
  name: number
  brand: number
}

export interface MatchingSynonymGroup {
  field: CanonicalMatchingField
  terms: string[]
}

export interface MatchingConfig {
  version: typeof MATCHING_CONFIG_VERSION
  field_weights: MatchingFieldWeights
  synonyms: MatchingSynonymGroup[]
  precision: MatchingPrecision
  typo_tolerance: boolean
  max_candidates: number
  minimum_score: number
  auto_approve: boolean
  auto_approve_threshold: number
}

const DEFAULT_FIELD_WEIGHTS: MatchingFieldWeights = {
  sku: 10,
  ean: 10,
  main_code: 9,
  oem: 8,
  trade_number: 8,
  name: 5,
  brand: 4,
}

const CONFIG_KEYS = [
  'version',
  'field_weights',
  'synonyms',
  'precision',
  'typo_tolerance',
  'max_candidates',
  'minimum_score',
  'auto_approve',
  'auto_approve_threshold',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && actualKeys.every(key => keys.includes(key))
}

function isCanonicalMatchingField(value: unknown): value is CanonicalMatchingField {
  return typeof value === 'string' && CANONICAL_MATCHING_FIELDS.some(field => field === value)
}

function isMatchingPrecision(value: unknown): value is MatchingPrecision {
  return value === 'strict' || value === 'balanced' || value === 'broad'
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
}

function parseFieldWeights(value: unknown): MatchingFieldWeights | null {
  if (!isRecord(value) || !hasOnlyKeys(value, CANONICAL_MATCHING_FIELDS)) return null
  if (!CANONICAL_MATCHING_FIELDS.every(field => isBoundedInteger(value[field], 0, 100))) return null

  return {
    sku: Number(value.sku),
    ean: Number(value.ean),
    main_code: Number(value.main_code),
    oem: Number(value.oem),
    trade_number: Number(value.trade_number),
    name: Number(value.name),
    brand: Number(value.brand),
  }
}

function parseSynonyms(value: unknown): MatchingSynonymGroup[] | null {
  if (!Array.isArray(value) || value.length > MAX_SYNONYM_GROUPS) return null

  const groups: MatchingSynonymGroup[] = []
  for (const group of value) {
    if (!isRecord(group) || !hasOnlyKeys(group, ['field', 'terms'])) return null
    if (!isCanonicalMatchingField(group.field)) return null
    if (!Array.isArray(group.terms) || group.terms.length < 2 || group.terms.length > MAX_SYNONYM_TERMS) return null
    if (!group.terms.every(term => typeof term === 'string' && term.trim().length > 0 && term.length <= MAX_SYNONYM_TERM_LENGTH)) {
      return null
    }

    const terms = group.terms.map(term => String(term).trim())
    if (new Set(terms.map(term => term.toLocaleLowerCase('pt-BR'))).size !== terms.length) return null
    groups.push({ field: group.field, terms })
  }
  return groups
}

function parseValidMatchingConfig(value: unknown): MatchingConfig | null {
  if (!isRecord(value) || !hasOnlyKeys(value, CONFIG_KEYS)) return null
  if (value.version !== MATCHING_CONFIG_VERSION) return null

  const fieldWeights = parseFieldWeights(value.field_weights)
  const synonyms = parseSynonyms(value.synonyms)
  if (!fieldWeights || !synonyms) return null
  if (!isMatchingPrecision(value.precision)) return null
  if (typeof value.typo_tolerance !== 'boolean' || typeof value.auto_approve !== 'boolean') return null
  if (!isBoundedInteger(value.max_candidates, 1, 10)) return null
  if (!isBoundedInteger(value.minimum_score, 0, 100)) return null
  if (!isBoundedInteger(value.auto_approve_threshold, 0, 100)) return null

  return {
    version: MATCHING_CONFIG_VERSION,
    field_weights: fieldWeights,
    synonyms,
    precision: value.precision,
    typo_tolerance: value.typo_tolerance,
    max_candidates: value.max_candidates,
    minimum_score: value.minimum_score,
    auto_approve: value.auto_approve,
    auto_approve_threshold: value.auto_approve_threshold,
  }
}

export function createDefaultMatchingConfig(): MatchingConfig {
  return {
    version: MATCHING_CONFIG_VERSION,
    field_weights: { ...DEFAULT_FIELD_WEIGHTS },
    synonyms: [],
    precision: 'balanced',
    typo_tolerance: true,
    max_candidates: 5,
    minimum_score: 0,
    auto_approve: true,
    auto_approve_threshold: 80,
  }
}

export function isMatchingConfig(value: unknown): value is MatchingConfig {
  return parseValidMatchingConfig(value) !== null
}

export function parseMatchingConfig(value: unknown): MatchingConfig {
  return parseValidMatchingConfig(value) ?? createDefaultMatchingConfig()
}
