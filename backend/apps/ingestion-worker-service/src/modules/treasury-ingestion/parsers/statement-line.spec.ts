import { parseStatementLines, type StructuralPattern } from './statement-line'

describe('parseStatementLines', () => {
  it('parses an ordinary line into a row with no structural hint', () => {
    const result = parseStatementLines(1, ['15/07/2026 Pix enviado ASSAI ATACADISTA LJ49 -R$1.234,56'], [])

    expect(result.rejections).toEqual([])
    expect(result.rows).toEqual([
      {
        occurredOn: '2026-07-15',
        amountCents: 123456,
        direction: 'outflow',
        counterpartyRaw: 'Pix enviado ASSAI ATACADISTA LJ49',
        sourceRef: 'p1L1',
      },
    ])
  })

  it('reads a positive amount as inflow', () => {
    const result = parseStatementLines(1, ['17/07/2026 Pix recebido AGILIZ.AI LTDA R$2.000,00'], [])
    expect(result.rows[0].direction).toBe('inflow')
  })

  it('ignores a line with no leading date — headers and footers, not rejections', () => {
    const result = parseStatementLines(1, ['Data | Descrição | Valor', 'página 1 de 3'], [])
    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('rejects, rather than skips, a line that has a date but no readable amount', () => {
    const result = parseStatementLines(1, ['15/07/2026 Pix enviado sem valor nenhum'], [])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([
      {
        rowReference: 'p1L1',
        reason: 'unparseable_amount',
        detail: expect.stringContaining('15/07/2026 Pix enviado sem valor nenhum'),
      },
    ])
  })

  it('applies a structural pattern, case-insensitively, over mapping resolution', () => {
    const patterns: StructuralPattern[] = [
      { matchText: 'PGTO FAT CARTAO C6', kind: 'movement', category: 'Pagamento de fatura' },
    ]
    const result = parseStatementLines(1, ['20/07/2026 pgto fat cartao c6 -R$900,00'], patterns)

    expect(result.rows[0].structuralHint).toEqual({ kind: 'movement', category: 'Pagamento de fatura' })
  })

  it('numbers source references by page and line', () => {
    const result = parseStatementLines(
      2,
      ['not a row', '15/07/2026 Pix enviado A R$10,00', '16/07/2026 Pix enviado B R$20,00'],
      [],
    )

    expect(result.rows.map(row => row.sourceRef)).toEqual(['p2L2', 'p2L3'])
  })

  // Regression: a bare vendor name is what add-treasury-classification-model's
  // seed stores as match_text ("AMBEV", not "Pix enviado AMBEV") — leaving the
  // bank's own verb label in counterpartyRaw meant every `exact` mapping rule
  // silently never matched a real statement line. Caught during live
  // end-to-end verification of add-treasury-statement-ingestion, not by any
  // unit test, because no test exercised a verbPrefixes-aware call before.
  it('strips a known verb prefix off counterpartyRaw, leaving the bare favorecido', () => {
    const result = parseStatementLines(1, ['15/07/2026 Pix enviado AMBEV -R$1.234,56'], [], ['Pix enviado'])

    expect(result.rows[0].counterpartyRaw).toBe('AMBEV')
  })

  it('matches a verb prefix accent- and case-insensitively, keeping the original casing of the remainder', () => {
    const result = parseStatementLines(1, ['15/07/2026 SAÍDA pix AMBEV -R$100,00'], [], ['Saída PIX'])

    expect(result.rows[0].counterpartyRaw).toBe('AMBEV')
  })

  // Regression: real PagBank text (measured 2026-08) is "Pix enviado - X",
  // with a dash between the verb and the favorecido — a raw token that is
  // pure punctuation normalizes away to nothing and silently misaligns the
  // raw/normalized token counts used to compute the slice point.
  it('drops a punctuation-only separator token left over after the verb prefix', () => {
    const result = parseStatementLines(1, ['15/07/2026 Pix enviado - F&r Solucoes Experience -R$4.300,00'], [], ['Pix enviado'])

    expect(result.rows[0].counterpartyRaw).toBe('F&r Solucoes Experience')
  })

  it('prefers the longest matching verb prefix over a shorter one it contains', () => {
    const result = parseStatementLines(
      1,
      ['15/07/2026 Pagamento de conta LUZ -R$300,00'],
      [],
      ['Pagamento', 'Pagamento de conta'],
    )

    expect(result.rows[0].counterpartyRaw).toBe('LUZ')
  })

  it('leaves counterpartyRaw untouched when no verb prefix matches', () => {
    const result = parseStatementLines(1, ['15/07/2026 Pix enviado AMBEV -R$1.234,56'], [], ['Entrada PIX'])

    expect(result.rows[0].counterpartyRaw).toBe('Pix enviado AMBEV')
  })

  // Regression: real PagBank text (measured on a jan-ago/2026 backfill) has
  // three recurring self-fees whose amount spills onto a continuation line
  // with no date of its own — "Pagamento com QR Code - Para: PAGSEGURO
  // INTERNET INSTITUICAO DE" / "PAGAMENTO -R$ 24,90". Before this, the
  // date-line had no amount and was rejected outright, 24 times across 8
  // real months (R$317,60 never imported, and never even surfaced as a
  // reviewable rejection with the right detail — a bare "unparseable_amount"
  // on the description line alone).
  it('joins a continuation line with no date of its own to find the amount', () => {
    const result = parseStatementLines(
      1,
      [
        '10/01/2026 Pagamento com QR Code - Para: PAGSEGURO INTERNET INSTITUICAO DE',
        'PAGAMENTO -R$ 24,90',
      ],
      [],
    )

    expect(result.rejections).toEqual([])
    expect(result.rows).toEqual([
      {
        occurredOn: '2026-01-10',
        amountCents: 2490,
        direction: 'outflow',
        counterpartyRaw: 'Pagamento com QR Code - Para: PAGSEGURO INTERNET INSTITUICAO DE PAGAMENTO',
        sourceRef: 'p1L1',
      },
    ])
  })

  it('stops joining continuation lines at the next dated line, and rejects if no amount was found', () => {
    const result = parseStatementLines(
      1,
      ['15/07/2026 Pix enviado sem valor nenhum', '16/07/2026 Pix enviado B R$20,00'],
      [],
    )

    expect(result.rows).toEqual([
      {
        occurredOn: '2026-07-16',
        amountCents: 2000,
        direction: 'inflow',
        counterpartyRaw: 'Pix enviado B',
        sourceRef: 'p1L2',
      },
    ])
    expect(result.rejections).toEqual([
      {
        rowReference: 'p1L1',
        reason: 'unparseable_amount',
        detail: expect.stringContaining('15/07/2026 Pix enviado sem valor nenhum'),
      },
    ])
  })
})
