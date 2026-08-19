import {
  hasColumn,
  hasRawColumn,
  locateRawHeaderRow,
  readColumn,
  readRawColumn,
  toCents,
  toExcelDate,
  toQuantity,
} from './row-mapping'

describe('readColumn (smartChunk-produced, slugified row keys)', () => {
  it('matches a header regardless of case, accents and spacing', () => {
    // "Nome produto" slugifies to "Nome_produto"; case-only drift still folds.
    expect(readColumn({ nome_produto: 'Guaraná' }, 'product')).toBe('Guaraná')
    expect(readColumn({ NOME_PRODUTO: 'Guaraná' }, 'product')).toBe('Guaraná')
  })

  it('accepts any of a column accepted names', () => {
    expect(readColumn({ Descricao: 'X' }, 'product')).toBe('X')
    expect(readColumn({ Produto: 'Y' }, 'product')).toBe('Y')
  })

  it('returns undefined for a missing or blank column, rather than an empty string', () => {
    expect(readColumn({ Nome_produto: '   ' }, 'product')).toBeUndefined()
    expect(readColumn({}, 'product')).toBeUndefined()
  })

  it('reads the real restocking column names, not the invented ones', () => {
    // These are the actual slugified forms `@app/sheeter` produces for
    // "Qtd. abastecida", "Remoções", "Diferença" and "Qtd. final" — the
    // wrong-column bug this parser was rewritten to fix matched "Remoções"
    // (the removed-quantity NUMBER) to what used to be called `removals`.
    expect(readColumn({ Qtd_abastecida: 6 }, 'restocked')).toBe(6)
    expect(readColumn({ Remocoes: -2 }, 'removedTotal')).toBe(-2)
    expect(readColumn({ Diferenca: -1 }, 'adjustment')).toBe(-1)
    expect(readColumn({ Qtd_final: 4 }, 'recordedClosingBalance')).toBe(4)
  })

  it('reads the reason text from its own column, never the count column', () => {
    expect(
      readColumn({ Remocoes: -9, Detalhes_das_Remocoes: '-6 Devolução, -3 Outro motivo' }, 'removalDetail'),
    ).toBe('-6 Devolução, -3 Outro motivo')
  })
})

describe('hasColumn', () => {
  it('detects a required column by any accepted name', () => {
    expect(hasColumn(['Produto', 'Qtd_vendida'], 'quantity')).toBe(true)
    expect(hasColumn(['Produto', 'Quantidade_Vendida'], 'quantity')).toBe(true)
  })

  it('reports a genuinely missing column', () => {
    expect(hasColumn(['Produto'], 'cost')).toBe(false)
  })
})

describe('readRawColumn / hasRawColumn (raw ExcelJS header text, before smartChunk)', () => {
  it('matches the export text unchanged, with case/accent/whitespace folding', () => {
    expect(readRawColumn({ 'Qtd. abastecida': 6 }, 'restocked')).toBe(6)
    expect(readRawColumn({ 'QTD. ABASTECIDA': 6 }, 'restocked')).toBe(6)
    expect(readRawColumn({ Cliente: 'Ascenty - JDI01' }, 'clientStore')).toBe('Ascenty - JDI01')
  })

  it('reports a genuinely missing raw column', () => {
    expect(hasRawColumn(['Cliente'], 'operationKind')).toBe(false)
    expect(hasRawColumn(['Cliente', 'Tipo de operação'], 'operationKind')).toBe(true)
  })
})

describe('locateRawHeaderRow', () => {
  it('finds the row carrying a column, searching rather than assuming a fixed position', () => {
    const rows = [
      ['ID PDV', 'Cliente', 'Tipo de operação'],
      [1, 'Ascenty - JDI01', 'Abastecimento'],
      [],
      ['ID produto', 'Código Produto', 'Nome produto'],
      [1, '6098', 'Produto'],
    ]

    expect(locateRawHeaderRow(rows, 'clientStore')).toBe(0)
    expect(locateRawHeaderRow(rows, 'productCode')).toBe(3)
  })

  it('returns null when nothing in the search window carries the column', () => {
    const rows = [['A', 'B'], ['1', '2']]
    expect(locateRawHeaderRow(rows, 'productCode', 2)).toBeNull()
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

  it('keeps the sign — Remoções and Diferença are legitimately negative', () => {
    expect(toQuantity(-4)).toBe(-4)
    expect(toQuantity('-10')).toBe(-10)
  })
})

describe('toExcelDate', () => {
  it('reads a serial day count relative to the spreadsheet epoch', () => {
    // 2026-04-01 is serial day 46113 in the 1900 date system.
    const date = toExcelDate(46113)
    expect(date?.getUTCFullYear()).toBe(2026)
    expect(date?.getUTCMonth()).toBe(3) // 0-indexed: April
    expect(date?.getUTCDate()).toBe(1)
  })

  it('passes through an already-parsed Date unchanged', () => {
    const original = new Date('2026-04-01T12:00:00Z')
    expect(toExcelDate(original)).toBe(original)
  })

  it('returns null for anything else', () => {
    expect(toExcelDate('not a date')).toBeNull()
    expect(toExcelDate(undefined)).toBeNull()
    expect(toExcelDate(null)).toBeNull()
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
