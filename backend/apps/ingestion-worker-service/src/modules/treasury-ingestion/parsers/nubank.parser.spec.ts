import { parseNubankStatement } from './nubank.parser'

const HEADER_NOISE = ['AGILIZ.AI LTDA', '60.819.321/0001-44 0001\tCNPJ Agência Conta', '738978222-5', 'a\t01 DE JANEIRO DE 2026 31 DE JULHO DE 2026 VALORES EM R$']

describe('parseNubankStatement', () => {
  it('assembles a multi-line record into one row', () => {
    const result = parseNubankStatement([
      {
        pageNumber: 1,
        lines: [
          'Movimentações',
          '13 JAN 2026 Total de entradas + 620,00',
          'Transferência Recebida ASCENTY DATA CENTERS E TELECOMUNICACOES',
          'S A - 13.743.550/0001-42 - ITAÚ UNIBANCO S.A.',
          '(0341) Agência: 910 Conta: 12109-4',
          '620,00',
        ],
      },
    ])

    expect(result.rejections).toEqual([])
    expect(result.rows).toEqual([
      {
        occurredOn: '2026-01-13',
        amountCents: 62000,
        direction: 'inflow',
        counterpartyRaw:
          'Transferência Recebida ASCENTY DATA CENTERS E TELECOMUNICACOES S A - 13.743.550/0001-42 - ITAÚ UNIBANCO S.A. (0341) Agência: 910 Conta: 12109-4',
        sourceRef: 'p1L3',
      },
    ])
  })

  // Regression: direction can change mid-day, on a sub-header with NO day
  // repeated ("Total de saídas -Y" alone) — not just once at the day's start.
  it('switches direction mid-day on a bare "Total de saídas" sub-header, without a new day marker', () => {
    const result = parseNubankStatement([
      {
        pageNumber: 1,
        lines: [
          'Movimentações',
          '13 JAN 2026 Total de entradas + 620,00',
          'Transferência Recebida X',
          '620,00',
          'Total de saídas - 100,00',
          'Transferência enviada pelo Pix Y',
          '100,00',
        ],
      },
    ])

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ direction: 'inflow', occurredOn: '2026-01-13' })
    expect(result.rows[1]).toMatchObject({ direction: 'outflow', occurredOn: '2026-01-13' })
  })

  it('ignores a "Saldo do dia" balance line, never a transaction', () => {
    const result = parseNubankStatement([
      { pageNumber: 1, lines: ['Movimentações', '13 JAN 2026 Total de entradas + 620,00', 'Transferência X', '620,00', 'Saldo do dia 620,00'] },
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rejections).toEqual([])
  })

  it('skips the repeated per-page header/footer noise', () => {
    const result = parseNubankStatement([
      {
        pageNumber: 1,
        lines: [...HEADER_NOISE, 'Movimentações', '13 JAN 2026 Total de entradas + 620,00', 'Transferência X', '620,00'],
      },
      {
        pageNumber: 2,
        lines: [...HEADER_NOISE, 'Tem alguma dúvida? Mande uma mensagem...', 'Caso a solução fornecida nos canais...', 'Extrato gerado dia 31 de julho de 2026'],
      },
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rejections).toEqual([])
  })

  // Regression: page 1's opening summary box has label/value lines BEFORE
  // "Movimentações" that must never be read as transaction content — gated
  // out entirely by requiring the "Movimentações" marker first.
  it('ignores everything before the "Movimentações" marker, including the summary box', () => {
    const result = parseNubankStatement([
      {
        pageNumber: 1,
        lines: [
          ...HEADER_NOISE,
          'Saldo final do período',
          'R$ 0,00',
          'Saldo inicial',
          'Rendimento líquido',
          'Total de entradas',
          'Total de saídas',
          'Saldo final do período',
          '0,00',
          '+0,00',
          '+358.574,75',
          '-358.574,75',
          '0,00',
          'Movimentações',
          '13 JAN 2026 Total de entradas + 620,00',
          'Transferência X',
          '620,00',
        ],
      },
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rejections).toEqual([])
  })

  // Regression: state (day, direction) survives a page break — a day's
  // block of transactions can continue past a pdf-parse page boundary
  // with no day header repeated on the new page.
  it('carries day/direction state across a page boundary', () => {
    const result = parseNubankStatement([
      { pageNumber: 1, lines: ['Movimentações', '13 JAN 2026 Total de entradas + 620,00'] },
      { pageNumber: 2, lines: [...HEADER_NOISE, 'Transferência X', '620,00'] },
    ])

    expect(result.rows).toEqual([
      expect.objectContaining({ occurredOn: '2026-01-13', direction: 'inflow', amountCents: 62000 }),
    ])
  })

  // Regression: a real page-break artifact in this document glues a
  // description and its amount onto ONE line ("...TELECOMUNICACOES
  // 580,00"), immediately followed by a fresh repeat of the same
  // transaction split normally across the next page. The glued line must
  // resolve as its OWN complete, correct row.
  it('resolves a description+amount glued onto one line as a complete row', () => {
    const result = parseNubankStatement([
      {
        pageNumber: 1,
        lines: ['Movimentações', '13 JAN 2026 Total de entradas + 500,00', 'Transferência Recebida ASCENTY DATA CENTERS E TELECOMUNICACOES 580,00'],
      },
    ])

    expect(result.rows).toEqual([
      {
        occurredOn: '2026-01-13',
        amountCents: 58000,
        direction: 'inflow',
        counterpartyRaw: 'Transferência Recebida ASCENTY DATA CENTERS E TELECOMUNICACOES',
        sourceRef: 'p1L3',
      },
    ])
  })

  it('rejects a closing amount with no day/direction header seen yet', () => {
    const result = parseNubankStatement([{ pageNumber: 1, lines: ['Movimentações', 'Transferência sem cabeçalho', '100,00'] }])

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([expect.objectContaining({ reason: 'missing_context' })])
  })
})
