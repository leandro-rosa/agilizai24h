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

  it('never sets structuralHint from the sheet\'s own Tipo/Detalhe columns — that is the operator\'s manual classification, not a structural fact', () => {
    const rows = [HEADER, ['2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'SEGURO CONTA C6 Ago 26', 'Seguro Conta Ago 26', 0, 20, 'seguro conta', 'seguro']]
    const result = parseC6StatementSheet(rows)
    expect(result.rows[0].structuralHint).toBeUndefined()
  })
})
