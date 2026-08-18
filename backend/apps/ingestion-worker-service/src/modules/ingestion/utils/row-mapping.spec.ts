import { hasColumn, readColumn, toCents, toQuantity } from './row-mapping'

describe('readColumn', () => {
  it('matches a header regardless of case, accents and spacing', () => {
    expect(readColumn({ ' PRODUTO ': 'Guaraná' }, 'product')).toBe('Guaraná')
  })

  it('accepts any of a column accepted names', () => {
    expect(readColumn({ Descricao: 'X' }, 'product')).toBe('X')
    expect(readColumn({ Item: 'Y' }, 'product')).toBe('Y')
  })

  it('returns undefined for a missing or blank column, rather than an empty string', () => {
    expect(readColumn({ Produto: '   ' }, 'product')).toBeUndefined()
    expect(readColumn({}, 'product')).toBeUndefined()
  })
})

describe('hasColumn', () => {
  it('detects a required column by any accepted name', () => {
    expect(hasColumn(['Produto', 'Quantidade'], 'quantity')).toBe(true)
    expect(hasColumn(['Produto', 'Qtd'], 'quantity')).toBe(true)
  })

  it('reports a genuinely missing column', () => {
    expect(hasColumn(['Produto'], 'cost')).toBe(false)
  })
})

describe('toCents', () => {
  it('reads the Brazilian decimal comma the exports use', () => {
    expect(toCents('12,50')).toBe(1250)
  })

  it('reads a thousands separator', () => {
    expect(toCents('1.234,56')).toBe(123456)
  })

  it('reads a plain number', () => {
    expect(toCents(2.5)).toBe(250)
    expect(toCents('R$ 3,00')).toBe(300)
  })

  it('rounds once at the boundary, so downstream stays integer', () => {
    expect(toCents('0,015')).toBe(2)
    expect(Number.isInteger(toCents('9,99'))).toBe(true)
  })

  it('returns null for a blank or unreadable value rather than zero', () => {
    // Zero is a real cost; blank is missing data, and the two must not merge.
    expect(toCents('')).toBeNull()
    expect(toCents(null)).toBeNull()
    expect(toCents('abc')).toBeNull()
  })

  it('reads an explicit zero as zero', () => {
    expect(toCents('0')).toBe(0)
  })
})

describe('toQuantity', () => {
  it('reads integers', () => {
    expect(toQuantity('12')).toBe(12)
    expect(toQuantity(-6)).toBe(-6)
  })

  it('truncates a fractional quantity rather than rounding it up', () => {
    expect(toQuantity('3,9')).toBe(39)
  })

  it('returns null for blank', () => {
    expect(toQuantity('')).toBeNull()
  })
})

describe('the silent-zero trap', () => {
  it.each(['abc', 'n/a', '-', '  '])('never turns the unreadable value %p into zero', value => {
    // Stripping non-numeric characters leaves an empty string, and Number('')
    // is 0. A value the file could not express must be reported as missing so
    // the row is rejected, not quietly counted as nothing.
    expect(toCents(value)).toBeNull()
    expect(toQuantity(value)).toBeNull()
  })
})
