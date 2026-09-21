import { todayInSaoPaulo } from './sao-paulo-date'

describe('todayInSaoPaulo', () => {
  it('is the date in São Paulo, which is three hours behind UTC', () => {
    expect(todayInSaoPaulo(new Date('2026-09-19T15:00:00Z'))).toBe('2026-09-19')
  })

  it('is still the previous day just after midnight UTC', () => {
    expect(todayInSaoPaulo(new Date('2026-09-20T02:30:00Z'))).toBe('2026-09-19')
  })

  it('rolls over at local midnight, not at UTC midnight', () => {
    expect(todayInSaoPaulo(new Date('2026-09-20T03:00:00Z'))).toBe('2026-09-20')
  })
})
