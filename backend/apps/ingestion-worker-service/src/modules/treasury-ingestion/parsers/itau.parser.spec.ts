import { parseItauStatement } from './itau.parser'

describe('parseItauStatement', () => {
  it('a SISPAG line stages as pending with no fornecedor guessed', () => {
    const result = parseItauStatement([{ pageNumber: 1, lines: ['20/07/2026 SISPAG PAGAMENTO DE FORNECEDOR -1.500,00'] }])

    expect(result.rows[0]).toMatchObject({
      direction: 'outflow',
      structuralHint: { kind: 'pending' },
    })
  })

  it('the shorter "SISPAG FORNECEDORES" wording also stages as pending', () => {
    const result = parseItauStatement([{ pageNumber: 1, lines: ['21/07/2026 SISPAG FORNECEDORES -800,00'] }])
    expect(result.rows[0].structuralHint).toEqual({ kind: 'pending' })
  })

  it('an ordinary receita line (PIX QR Code / Recebimento Rede) has no structural hint', () => {
    const result = parseItauStatement([{ pageNumber: 1, lines: ['22/07/2026 Recebimento Rede 340,00'] }])
    expect(result.rows[0].structuralHint).toBeUndefined()
    expect(result.rows[0].direction).toBe('inflow')
  })

  // Regression: real text has essentially no R$ marker on any transaction
  // line — findMoneyInText (which mandates it) rejects every real line.
  it('finds an amount with no R$ marker at all', () => {
    const result = parseItauStatement([{ pageNumber: 1, lines: ['03/08/2026 SISPAG FORNECEDORES -670,00'] }])
    expect(result.rows[0].amountCents).toBe(67000)
  })

  // Regression: a wrapped description with the QR-CODE text itself split
  // mid-word across the line break — the amount is on the continuation line.
  it('joins a two-line wrapped record ("...PIX QR-" / "CODE -amount")', () => {
    const result = parseItauStatement([
      { pageNumber: 1, lines: ['03/08/2026 SISPAG FORNECEDORES PIX QR-', 'CODE -957,24'] },
    ])

    expect(result.rows[0]).toMatchObject({ amountCents: 95724, direction: 'outflow' })
    expect(result.rows[0].structuralHint).toEqual({ kind: 'pending' })
  })

  // Regression: a long razão social pushes the CNPJ and amount onto a
  // SECOND physical line with no date of its own.
  it('joins a two-line wrapped record (long razão social)', () => {
    const result = parseItauStatement([
      {
        pageNumber: 1,
        lines: [
          '03/08/2026 PIX RECEBIDO BARBARA03/08 BARBARA OLIVEIRA FERNANDES',
          'LTDA 60.819.321/0001-44 2.411,00',
        ],
      },
    ])

    expect(result.rows[0]).toMatchObject({
      amountCents: 241100,
      direction: 'inflow',
      counterpartyRaw: 'PIX RECEBIDO BARBARA03/08 BARBARA OLIVEIRA FERNANDES LTDA 60.819.321/0001-44',
    })
  })

  // Regression: real records can wrap across up to THREE continuation
  // lines, not just one — a fixed 1-line lookahead is not enough.
  it('joins a record spanning three continuation lines', () => {
    const result = parseItauStatement([
      {
        pageNumber: 1,
        lines: [
          '21/07/2026 RECEBIMENTO REDE ELO',
          'CD0107244993',
          'REDECARD INSTITUICAO DE',
          'PAGAMENTO S.A. 01.425.787/0001-04 34,83',
        ],
      },
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ amountCents: 3483, direction: 'inflow' })
  })

  // Regression: "SALDO TOTAL DISPONÍVEL DIA" / "SALDO EM CONTA CORRENTE"
  // share the exact DD/MM/YYYY-text-bareNumber shape a real transaction
  // has and must never be silently counted as one.
  it('excludes a "SALDO TOTAL DISPONÍVEL DIA" balance line', () => {
    const result = parseItauStatement([{ pageNumber: 1, lines: ['31/07/2026 SALDO TOTAL DISPONÍVEL DIA 8.745,43'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('excludes a "SALDO EM CONTA CORRENTE" balance line', () => {
    const result = parseItauStatement([{ pageNumber: 1, lines: ['03/08/2026 SALDO EM CONTA CORRENTE 7.015,80'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  // Found live during the real-file backfill (2026-08-26): a statement whose page range
  // starts mid-month carries an opening-balance carry-forward dated to the prior month's
  // last day — same label Bradesco's own "SALDO ANTERIOR" row uses — which was slipping
  // through as a phantom zero-amount transaction dated a month before any real line.
  it('excludes a "SALDO ANTERIOR" opening-balance carry-forward line', () => {
    const result = parseItauStatement([{ pageNumber: 1, lines: ['30/04/2026 SALDO ANTERIOR 0,00'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('rejects a dated line whose continuation lines never carry an amount, stopping at the next dated line', () => {
    const result = parseItauStatement([
      { pageNumber: 1, lines: ['03/08/2026 LINHA SEM VALOR NENHUM', 'MAIS TEXTO SEM VALOR', '04/08/2026 SISPAG FORNECEDORES -100,00'] },
    ])

    expect(result.rejections).toEqual([expect.objectContaining({ rowReference: 'p1L1', reason: 'unparseable_amount' })])
    expect(result.rows).toEqual([expect.objectContaining({ occurredOn: '2026-08-04', amountCents: 10000 })])
  })
})
