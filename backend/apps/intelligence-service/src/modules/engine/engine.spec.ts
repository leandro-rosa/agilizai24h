import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { coverageCategory, ENGINE_VERSION, runPair } from './engine'
import { inputFromReal } from './engine.testing'
import type { PairInput } from './engine.types'
import { REAL_PAIRS } from './real-pairs.fixture'

const input = (): PairInput => inputFromReal(REAL_PAIRS.trident_menta_adm, { baseline: 21 })

describe('runPair', () => {
  it('is deterministic: the same input gives the same result', () => {
    expect(JSON.stringify(runPair(input()))).toBe(JSON.stringify(runPair(input())))
  })

  it('stamps the engine version it ran with', () => {
    expect(runPair(input()).engineVersion).toBe(ENGINE_VERSION)
  })

  it('never mutates its input', () => {
    const frozen = input()
    const before = JSON.stringify(frozen)
    // freezing the arrays makes any in-place sort or push throw instead of passing silently
    Object.freeze(frozen.visits)
    Object.freeze(frozen.monthly)

    runPair(frozen)

    expect(JSON.stringify(frozen)).toBe(before)
  })

  it('reads nothing after the reference date', () => {
    const early = runPair({ ...input(), asOf: new Date('2026-04-30T23:59:59Z') })

    expect(new Date(early.exposure.lastVisit as string).getTime()).toBeLessThanOrEqual(new Date('2026-04-30T23:59:59Z').getTime())
  })

  it('explains itself: facts, evidence to keep, evidence to change and limitations', () => {
    const { explanation } = runPair(input())

    expect(explanation.facts.length).toBeGreaterThan(0)
    expect(explanation.limitations.join(' ')).toMatch(/ESTIMATE, never physical stock/)
    expect(explanation.limitations.join(' ')).toMatch(/same point of sale/)
  })

  it('has no field that says how much to bring: that is a separate, later calculation and never the ideal quantity', () => {
    const keys = JSON.stringify(Object.keys(JSON.parse(JSON.stringify(runPair(input())))))

    expect(keys).not.toMatch(/bring|levar|nextRestock|toBring/i)
  })

  it('carries no verdict or approval wording', () => {
    const walk = (value: unknown, out: string[] = []): string[] => {
      if (Array.isArray(value)) value.forEach(v => walk(v, out))
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          out.push(k)
          walk(v, out)
        }
      }
      return out
    }

    expect(walk(runPair(input())).filter(key => /verdict|approved|pass|fail|accept/i.test(key))).toEqual([])
  })
})

describe('the engine is pure', () => {
  const dir = __dirname
  const sources = readdirSync(dir).filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts') && name !== 'engine.testing.ts' && name !== 'real-pairs.fixture.ts')

  it('imports no database, HTTP, filesystem, queue or sibling-service code — so it cannot act', () => {
    for (const name of sources) {
      const text = readFileSync(join(dir, name), 'utf8')

      expect(text).not.toMatch(/from '(\.\.\/)+(db-client|sources|baseline|flags|schedule)\b|PrismaClient|AxiosHttpClient|@nestjs|@app\/(hold-it|http-client)|from 'fs'|node:fs|fetch\(|Date\.now\(|new Date\(\)/)
    }
  })
})

describe('coverageCategory — exactly one category, in a fixed order', () => {
  const base = { isNew: false, uncensoredObservations: 8, minObservations: 3, conflicts: 0, tolerance: 'within_tolerance' as const }

  it('maps the tolerance status to its analysable category', () => {
    expect(coverageCategory(base)).toBe('analysable_reliable_balance')
    expect(coverageCategory({ ...base, tolerance: 'outside_tolerance' })).toBe('analysable_unreliable_balance')
    expect(coverageCategory({ ...base, tolerance: 'not_verifiable' })).toBe('analysable_not_enough_counts')
  })

  it('conflicting data wins over the balance status', () => {
    expect(coverageCategory({ ...base, conflicts: 2 })).toBe('conflicting_data')
  })

  it('insufficient history wins over everything — a new SKU or too few observations', () => {
    expect(coverageCategory({ ...base, isNew: true, conflicts: 2 })).toBe('insufficient_history')
    expect(coverageCategory({ ...base, uncensoredObservations: 1 })).toBe('insufficient_history')
  })
})
