import { feeCents, normalizeCounterparty, PERIOD_PATTERN } from './treasury-vocabulary'

describe('feeCents', () => {
  it('applies a basis-point rate to a cents amount', () => {
    // 1,39% de débito sobre R$ 100,00
    expect(feeCents(10_000, 139)).toBe(139)
  })

  it('rounds once, at the end', () => {
    // 2,97% de R$ 33,33 = 98,99...  centavos -> 99, nao 98.
    expect(feeCents(3_333, 297)).toBe(99)
  })

  it('is exact for a zero rate', () => {
    expect(feeCents(123_456, 0)).toBe(0)
  })

  it('summing per-transaction fees stays within a cent of the batch fee', () => {
    // O motivo de arredondar so no fim: a diferenca entre somar taxas
    // arredondadas e taxar a soma e o que faz a conciliacao nao fechar.
    const amounts = [1_999, 2_499, 899, 15_050, 7_777]
    const perTransaction = amounts.reduce((sum, a) => sum + feeCents(a, 297), 0)
    const onTotal = feeCents(
      amounts.reduce((sum, a) => sum + a, 0),
      297,
    )
    expect(Math.abs(perTransaction - onTotal)).toBeLessThanOrEqual(3)
  })
})

describe('normalizeCounterparty', () => {
  it('folds the spellings the real statement carries', () => {
    expect(normalizeCounterparty('ASSAÍ ATACADISTA LJ49')).toBe('ASSAI ATACADISTA LJ49')
  })

  it('agrees with the suppliers-service folding', () => {
    // Os dois lados precisam concordar, senao o DE-PARA resolve e o
    // suppliers-service nao (ou o contrario).
    expect(normalizeCounterparty('AMLabs-Ventures')).toBe('AMLABS VENTURES')
  })
})

describe('PERIOD_PATTERN', () => {
  it('accepts a real period', () => {
    expect(PERIOD_PATTERN.test('2026-07')).toBe(true)
  })

  it('rejects month 00 and 13', () => {
    expect(PERIOD_PATTERN.test('2026-00')).toBe(false)
    expect(PERIOD_PATTERN.test('2026-13')).toBe(false)
  })
})
