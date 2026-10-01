import { parsePagBankStatementSheet } from './pagbank-statement-sheet.parser'

function cell(text: string) {
  return { richText: [{ text }] }
}

const HEADER = [null, cell('Data'), cell('Tipo'), cell('Descrição'), cell('Entradas'), cell('Saidas'), cell('Saldo')]

describe('parsePagBankStatementSheet', () => {
  it('parses a real inflow row (Entradas populated)', () => {
    const rows = [HEADER, [null, '01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows[0]).toEqual({
      occurredOn: '2026-09-01',
      amountCents: 586,
      direction: 'inflow',
      counterpartyRaw: 'Disponivel PIX',
      sourceRef: 'row2',
    })
  })

  it('parses an outflow row (Saidas populated)', () => {
    const rows = [HEADER, [null, '02/09/2026', 'Compra', 'Pagamento fornecedor', null, 120.5, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows[0].direction).toBe('outflow')
    expect(result.rows[0].amountCents).toBe(12050)
  })

  it('rejects a row with neither Entradas nor Saidas populated', () => {
    const rows = [HEADER, [null, '02/09/2026', 'Tipo', 'Descrição', null, null, 100]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('no_amount')
  })

  it('rejects a row with an unparseable date rather than dropping it', () => {
    const rows = [HEADER, [null, 'not-a-date', 'Vendas', 'Disponivel PIX', 5.86, null, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections[0].reason).toBe('unparseable_date')
  })

  it('never sets structuralHint — no equivalent PATTERNS list exists for PagBank sheets, and Tipo is the operator-adjacent column here too', () => {
    const rows = [HEADER, [null, '01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null]]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })

  /**
   * The real file has a metadata preamble before the header (Nome do Titular/Banco/blank rows —
   * confirmed by Task 3's detection fixture, header at 0-indexed row 8 of the real file) and
   * Task 8's own routing plan feeds this parser the FULL sheet rows, unsliced
   * (`SHEET_PARSERS[detectedSource](result.sheets[0].rows)`). A parser that assumed `rows[0]` is
   * always the header (the literal C6-mirroring reference code) would silently misread every row
   * as a rejection once wired into that real call shape. This fixture is Task 8's own
   * `PAGBANK_SHEET` test data verbatim — plain strings, no richText wrapper, no leading null
   * column — to prove the header is genuinely LOCATED, not assumed at a fixed row or cell shape.
   */
  it('locates the real header row past the metadata/blank preamble rows — the shape Task 8 actually feeds this parser', () => {
    const rows = [
      ['Nome do Titular : AGILIZ.AI LTDA'],
      ['Banco : 290 - PagSeguro Internet S/A'],
      [],
      ['Data', 'Tipo', 'Descrição', 'Entradas', 'Saidas', 'Saldo'],
      ['01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null],
    ]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      occurredOn: '2026-09-01',
      amountCents: 586,
      direction: 'inflow',
      counterpartyRaw: 'Disponivel PIX',
    })
  })

  it('rejects the whole file with unrecognized_columns when no row in the search window contains the required headers', () => {
    const rows = [['Something'], ['Unrelated'], ['Header']]
    const result = parsePagBankStatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('unrecognized_columns')
  })
})
