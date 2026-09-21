import { parseC6Statement } from './c6-statement.parser'

const HEADER = 'Janeiro 2026 ( 01/01/2026 - 31/01/2026 ) \tEntradas: R$ 95.893,18 • Saídas: R$ 78.984,29'

describe('parseC6Statement', () => {
  it('strips "Pix recebido de", so counterpartyRaw is the bare favorecido a mapping rule can match', () => {
    const result = parseC6Statement([
      { pageNumber: 1, lines: [HEADER, '03/01 \t05/01 \tEntrada PIX \tPix recebido de BARBARA OLIVEIRA FERNANDES LTDA \tR$ 4.300,00'] },
    ])

    expect(result.rows[0]).toMatchObject({
      occurredOn: '2026-01-03',
      amountCents: 430000,
      direction: 'inflow',
      counterpartyRaw: 'BARBARA OLIVEIRA FERNANDES LTDA',
    })
  })

  it('strips "Pix enviado para"', () => {
    const result = parseC6Statement([{ pageNumber: 1, lines: [HEADER, '05/01 \t05/01 \tSaída PIX \tPix enviado para PLENA SAUDE \t-R$ 485,32'] }])

    expect(result.rows[0].counterpartyRaw).toBe('PLENA SAUDE')
    expect(result.rows[0].direction).toBe('outflow')
  })

  it('leaves a bare Tipo (Pagamento/Outros gastos/Entradas/Débito de Cartão) untouched, no verb to strip', () => {
    const result = parseC6Statement([{ pageNumber: 1, lines: [HEADER, '15/01 \t15/01 \tPagamento \tAMLABS VENTURES \t-R$ 2.608,80'] }])

    expect(result.rows[0].counterpartyRaw).toBe('AMLABS VENTURES')
  })

  it('surfaces a Débito de Cartão deslocamento merchant name with city/state suffix intact', () => {
    const result = parseC6Statement([
      { pageNumber: 1, lines: [HEADER, '13/02 \t13/02 \tDébito de Cartão \tOBRAMAX PRAIA GRANDE PRAIA GRANDE BRA \t-R$ 403,64'] },
    ])

    expect(result.rows[0].counterpartyRaw).toBe('OBRAMAX PRAIA GRANDE PRAIA GRANDE BRA')
  })

  it('still recognises PGTO FAT CARTAO C6 as a structural movement', () => {
    const result = parseC6Statement([{ pageNumber: 1, lines: [HEADER, '28/01 \t28/01 \tPagamento \tPGTO FAT CARTAO C6 \t-R$ 1.372,66'] }])

    expect(result.rows[0].structuralHint).toEqual({ kind: 'movement', category: 'Pagamento de fatura' })
  })

  // Regression: real lines carry NO year at all (only DD/MM, twice) — the
  // year comes solely from a "Mês AAAA ( DD/MM/AAAA - ... )" section header
  // seen earlier in the document. Without one, the line can't be dated.
  it('rejects a transaction line with no section header seen yet', () => {
    const result = parseC6Statement([{ pageNumber: 1, lines: ['03/01 \t05/01 \tOutros gastos \tSEGURO CONTA C6 \t-R$ 20,00'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([{ rowReference: 'p1L1', reason: 'missing_year', detail: expect.stringContaining('SEGURO CONTA C6') }])
  })

  // "Saldo do dia DD/MM/AA" carries the exact same DD/MM shape as a real
  // transaction date but is a balance snapshot, not a movement — it must
  // never be silently counted as one.
  it('ignores a "Saldo do dia" balance line, not a transaction', () => {
    const result = parseC6Statement([{ pageNumber: 1, lines: [HEADER, 'Saldo do dia 05/01/26 \tR$ 4.048,10'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('carries "current year" state across a page break within the same month section', () => {
    const result = parseC6Statement([
      { pageNumber: 1, lines: [HEADER] },
      { pageNumber: 2, lines: ['19/01 \t19/01 \tSaída PIX \tPix enviado para Meryellen dos Santos Plaza Duarte \t-R$ 310,50'] },
    ])

    expect(result.rows[0].occurredOn).toBe('2026-01-19')
  })

  // Regression: "Cheque especial" is C6's name for the same overdraft
  // product Itaú calls "Conta Garantida" — both unified under one category
  // (operator request, 2026-09-17) so "quanto de juros paguei pelo limite"
  // is one number across banks, not split into two generic tax buckets.
  it('classifies "JUROS CHEQUE ESP" and "IOF CHEQUE ESPECIAL" under the same overdraft-interest category', () => {
    const result = parseC6Statement([
      {
        pageNumber: 1,
        lines: [HEADER, '04/08 \t04/08 \tOutros gastos \tJUROS CHEQUE ESP \t-R$ 199,28', '04/08 \t04/08 \tOutros gastos \tIOF CHEQUE ESPECIAL \t-R$ 30,97'],
      },
    ])

    expect(result.rows[0].structuralHint).toEqual({ kind: 'expense', category: 'Juros - Limite Garantido' })
    expect(result.rows[1].structuralHint).toEqual({ kind: 'expense', category: 'Juros - Limite Garantido' })
  })
})
