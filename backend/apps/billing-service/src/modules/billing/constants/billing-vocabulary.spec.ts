import { agingBucket, daysOverdue, dueDate, revenueShareCents } from './billing-vocabulary'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('dueDate', () => {
  it('adds the payment term to the issue date', () => {
    // A planilha usa 30 dias: emitida 14/01, paga 13/02.
    expect(dueDate(d('2026-01-14'), 30).toISOString().slice(0, 10)).toBe('2026-02-13')
  })

  it('crosses a month boundary correctly', () => {
    expect(dueDate(d('2026-01-31'), 30).toISOString().slice(0, 10)).toBe('2026-03-02')
  })
})

describe('daysOverdue', () => {
  it('is zero on the due date — a note due today is not overdue', () => {
    expect(daysOverdue(d('2026-02-13'), d('2026-02-13'))).toBe(0)
  })

  it('is negative before the due date', () => {
    expect(daysOverdue(d('2026-02-13'), d('2026-02-10'))).toBe(-3)
  })

  it('counts whole days after the due date', () => {
    expect(daysOverdue(d('2026-02-13'), d('2026-03-15'))).toBe(30)
  })

  it('ignores time of day', () => {
    // Comparar com hora faria a nota virar "vencida" as 00:00:01.
    const lateInTheDay = new Date('2026-02-13T23:59:59.000Z')
    expect(daysOverdue(d('2026-02-13'), lateInTheDay)).toBe(0)
  })
})

describe('agingBucket', () => {
  it('puts a not-yet-due note in not_due', () => {
    expect(agingBucket(d('2026-03-01'), d('2026-02-13'))).toBe('not_due')
  })

  it('puts a note due today in not_due', () => {
    expect(agingBucket(d('2026-02-13'), d('2026-02-13'))).toBe('not_due')
  })

  it('splits at the bucket edges', () => {
    expect(agingBucket(d('2026-02-13'), d('2026-02-14'))).toBe('d1_30')
    expect(agingBucket(d('2026-02-13'), d('2026-03-15'))).toBe('d1_30')
    expect(agingBucket(d('2026-02-13'), d('2026-03-16'))).toBe('d31_60')
    expect(agingBucket(d('2026-02-13'), d('2026-04-14'))).toBe('d31_60')
    expect(agingBucket(d('2026-02-13'), d('2026-04-15'))).toBe('d60_plus')
  })
})

describe('revenueShareCents', () => {
  it('applies a basis-point rate', () => {
    // 5% sobre R$ 1.980,00
    expect(revenueShareCents(198_000, 500)).toBe(9_900)
  })

  it('is zero for a contract with no revenue share', () => {
    expect(revenueShareCents(198_000, 0)).toBe(0)
  })
})
