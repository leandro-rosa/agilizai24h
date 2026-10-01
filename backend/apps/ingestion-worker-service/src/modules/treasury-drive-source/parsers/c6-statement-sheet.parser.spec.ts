import { parseC6StatementSheet } from './c6-statement-sheet.parser'

const HEADER = ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']

describe('parseC6StatementSheet', () => {
  it('parses an inflow row (Entrada populated, Saída empty/zero)', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'Pix recebido de ALELO S.A.', 'Pix recebido de ALELO S.A.', 445.93, 0]]
    const result = parseC6StatementSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows).toEqual([{
      occurredOn: '2026-08-03',
      amountCents: 44593,
      direction: 'inflow',
      counterpartyRaw: 'Pix recebido de ALELO S.A.',
      sourceRef: 'row2',
    }])
  })

  it('parses an outflow row (Saída populated, Entrada empty/zero)', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'DEBITO DE CARTAO ', 'REST FRANGOASSADO CAJ  CAJAMAR       BRA', 0, 36.69, 'Deslocamento', 'alimentação']]
    const result = parseC6StatementSheet(rows)
    expect(result.rows[0].direction).toBe('outflow')
    expect(result.rows[0].amountCents).toBe(3669)
    expect(result.rows[0].counterpartyRaw).toBe('REST FRANGOASSADO CAJ  CAJAMAR       BRA')
  })

  it('rejects a row with neither Entrada nor Saída populated', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'Título', 'Descrição', 0, 0]]
    const result = parseC6StatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('no_amount')
  })

  it('rejects a row with an unparseable date rather than dropping it silently', () => {
    const rows = [HEADER, ['not-a-date', '2026-08-03T00:00:00.000Z', 'Título', 'Descrição', 10, 0]]
    const result = parseC6StatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('unparseable_date')
  })

  it('sets structuralHint from Título when it contains a bank-printed structural pattern', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'SEGURO CONTA C6 Ago 26', 'Seguro Conta Ago 26', 0, 20, 'seguro conta', 'seguro']]
    const result = parseC6StatementSheet(rows)
    expect(result.rows[0].structuralHint).toEqual({ kind: 'expense', category: 'Financeiro/Tributos' })
  })

  it('never sets structuralHint from the sheet\'s own Tipo/Detalhe columns — those are the operator\'s manual classifications, not structural facts', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'Regular transaction', 'REST FRANGOASSADO CAJ', 0, 100, 'seguro conta', 'seguro']]
    const result = parseC6StatementSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })

  it('rejects the whole file with unrecognized_columns when a required header is missing, rather than silently reading undefined cells', () => {
    const headerMissingTitulo = ['Data Lançamento', 'Data Contábil', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']
    const rows = [headerMissingTitulo, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'Pix recebido de ALELO S.A.', 445.93, 0]]
    const result = parseC6StatementSheet(rows)
    expect(result.rows).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0].reason).toBe('unrecognized_columns')
  })

  it('locates the real header past a metadata preamble, instead of assuming row 0 is the header — real September file shape: title/blank/agência-conta/generated-at/blank/period/blank, header at row 8', () => {
    const rows = [
      [null, 'EXTRATO DE CONTA CORRENTE C6 BANK'],
      [],
      [null, 'Agência: 1 / Conta: 405968949'],
      [null, 'Extrato gerado em 01/10/2026 - as 12:07:10'],
      [],
      [null, 'Extrato de 01/09/2026 a 30/09/2026'],
      [],
      HEADER,
      ['2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'Pix recebido de AGILIZ.AI LTDA', 'Pix recebido de AGILIZ.AI LTDA', 7800, 0],
    ]
    const result = parseC6StatementSheet(rows)
    expect(result.rejections).toEqual([])
    expect(result.rows).toEqual([{
      occurredOn: '2026-09-01',
      amountCents: 780000,
      direction: 'inflow',
      counterpartyRaw: 'Pix recebido de AGILIZ.AI LTDA',
      sourceRef: 'row9',
    }])
  })
})
