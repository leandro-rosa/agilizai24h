import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { MatchingConfigDto } from './matching-config.dto'

const validConfig = {
  expected_revision: 0,
  version: 1,
  field_weights: { sku: 10, ean: 10, main_code: 9, oem: 8, trade_number: 8, name: 5, brand: 4 },
  synonyms: [{ field: 'name', terms: ['amortecedor', 'shock'] }],
  precision: 'balanced',
  typo_tolerance: true,
  max_candidates: 5,
  minimum_score: 0,
  auto_approve: true,
  auto_approve_threshold: 80,
}

async function validationErrors(payload: unknown) {
  return validate(plainToInstance(MatchingConfigDto, payload), {
    forbidNonWhitelisted: true,
    whitelist: true,
  })
}

describe('MatchingConfigDto', () => {
  it('accepts a deeply valid bounded configuration', async () => {
    await expect(validationErrors(validConfig)).resolves.toHaveLength(0)
  })

  it.each([
    ['unknown root setting', { ...validConfig, elasticsearch_query: { match_all: {} } }],
    ['unknown field weight', { ...validConfig, field_weights: { ...validConfig.field_weights, warehouse: 100 } }],
    ['candidate limit above ten', { ...validConfig, max_candidates: 11 }],
    ['score below zero', { ...validConfig, minimum_score: -1 }],
    ['empty synonym group', { ...validConfig, synonyms: [{ field: 'name', terms: [] }] }],
    ['oversized synonym group', { ...validConfig, synonyms: [{ field: 'name', terms: Array(11).fill('term') }] }],
    ['unsupported synonym field', { ...validConfig, synonyms: [{ field: 'warehouse', terms: ['a', 'b'] }] }],
    ['negative expected revision', { ...validConfig, expected_revision: -1 }],
    ['fractional expected revision', { ...validConfig, expected_revision: 1.5 }],
  ])('rejects %s', async (_caseName, payload) => {
    expect(await validationErrors(payload)).not.toHaveLength(0)
  })
})
