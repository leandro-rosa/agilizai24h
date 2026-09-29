import { parseItauStatementSheet } from './itau-statement-sheet.parser'

/**
 * Real header block, read via the project's own `readWorkbookRows` against the actual Aug/2026
 * Itaú statement Google Sheet (`Entradas_Saidas_ag2059cc996765_15-09-26`, found under
 * "Extratos/agosto/itau" in the real treasury Drive folder — fetched live for this task, see
 * task-5-report.md for the fetch transcript). Kept exactly as ExcelJS produced it: the labeled
 * rows' value cell is merged across two columns, so `row.values` echoes the same value into
 * both — not a fixture artifact, this is what production actually reads. Row 8 (0-indexed) is a
 * genuinely empty row (zero cells), also as ExcelJS produced it.
 */
const REAL_HEADER_BLOCK: unknown[][] = [
  [null, null, null],
  ['Atualização:', '15/09/2026 09:39:30', '15/09/2026 09:39:30'],
  ['Nome:', 'F&R SOLUCOES EXPERIENCE', 'F&R SOLUCOES EXPERIENCE'],
  ['Agência:', '2059', '2059'],
  ['Conta:', '0099676-5', '0099676-5'],
  [null, null, null],
  ['Lançamentos', 'Lançamentos', 'Lançamentos'],
  ['Periodo:', '01/08/2026 até 31/08/2026', '01/08/2026 até 31/08/2026'],
  [],
]

/** The real transaction-table header — row 10 of the sheet (index 9), confirmed against the real file. */
const REAL_TABLE_HEADER = ['Data', 'Lançamento', 'Razão Social', 'CPF/CNPJ', 'Valor (R$)', 'Saldo (R$)']

function withHeader(...dataRows: unknown[][]): unknown[][] {
  return [...REAL_HEADER_BLOCK, REAL_TABLE_HEADER, ...dataRows]
}

describe('parseItauStatementSheet', () => {
  it('parses a real outflow row (Razão Social present) into a TreasuryRawRow', () => {
    // Real row from the fetched file: 31/08/2026, "BOLETO PAGO PEPSICO DO B", -1386.36.
    const rows = withHeader(['31/08/2026', 'BOLETO PAGO PEPSICO DO B', 'PEPSICO DO BRASIL LTDA', '31.565.104/0021-10', -1386.36])
    const result = parseItauStatementSheet(rows)

    expect(result.rejections).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({
      occurredOn: '2026-08-31',
      amountCents: 138636,
      direction: 'outflow',
      counterpartyRaw: 'PEPSICO DO BRASIL LTDA',
      sourceRef: 'row11',
    })
  })

  it('parses a real inflow row whose sheet cell is a plain integer (no decimal part)', () => {
    // Real row: 31/08/2026, "PIX RECEBIDO AGILIZ.31/08", 1300 (an integer, not "1300.00").
    const rows = withHeader(['31/08/2026', 'PIX RECEBIDO AGILIZ.31/08', 'AGILIZ.AI LTDA', '60.819.321/0001-44', 1300])
    const result = parseItauStatementSheet(rows)

    expect(result.rejections).toEqual([])
    expect(result.rows[0]).toMatchObject({
      occurredOn: '2026-08-31',
      amountCents: 130000,
      direction: 'inflow',
      counterpartyRaw: 'AGILIZ.AI LTDA',
    })
  })

  it('rejects a row whose date cannot be parsed rather than silently skipping it', () => {
    const rows = withHeader(['31/13/2026', 'PIX RECEBIDO AGILIZ.31/08', 'AGILIZ.AI LTDA', '60.819.321/0001-44', 1300])
    const result = parseItauStatementSheet(rows)

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([expect.objectContaining({ rowReference: 'row11', reason: 'unparseable_date' })])
  })

  it('rejects a row whose amount cannot be parsed rather than silently skipping it', () => {
    const rows = withHeader(['31/08/2026', 'PIX RECEBIDO AGILIZ.31/08', 'AGILIZ.AI LTDA', '60.819.321/0001-44', 'invalid'])
    const result = parseItauStatementSheet(rows)

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([expect.objectContaining({ rowReference: 'row11', reason: 'unparseable_amount' })])
  })

  // Real line, seen once per day throughout the fetched file: shares the transaction table's
  // exact row shape (a date, a label, a number) but the number is in "Saldo (R$)", not
  // "Valor (R$)" (which is null/blank) — a snapshot, not a movement. Same ghost-line risk the
  // PDF `itau.parser.ts` already guards against (see its BALANCE_LINE_PATTERNS).
  it('excludes the real "SALDO TOTAL DISPONÍVEL DIA" daily balance line', () => {
    const rows = withHeader(['31/08/2026', 'SALDO TOTAL DISPONÍVEL DIA', '', '', null, 5686.12])
    const result = parseItauStatementSheet(rows)

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  // Real line, found at the very tail of the fetched file (dated to the last day of the PRIOR
  // month) — the opening-balance carry-forward, same label Bradesco's own export uses. Already
  // a confirmed real gap in the PDF parser's history (ingestion-worker-service/CLAUDE.md).
  it('excludes the real "SALDO ANTERIOR" opening-balance carry-forward line', () => {
    const rows = withHeader(['31/07/2026', 'SALDO ANTERIOR', '', '', null, 8745.43])
    const result = parseItauStatementSheet(rows)

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([])
  })

  // Real line (appears 15+ times in the fetched file), always with an EMPTY Razão Social/CPF —
  // the sheet gives no fornecedor at all for this label, same as the PDF. `itau.parser.ts`
  // already forces this to `pending` rather than let a guessed payee through; reused here so
  // the Drive-sourced path isn't strictly worse than the already-shipped PDF path for the exact
  // same real transaction type.
  it('classifies a real "SISPAG FORNECEDORES" line as pending, with no fornecedor guessed', () => {
    const rows = withHeader(['27/08/2026', 'SISPAG FORNECEDORES', '', '', -500])
    const result = parseItauStatementSheet(rows)

    expect(result.rows[0]).toMatchObject({
      direction: 'outflow',
      amountCents: 50000,
      counterpartyRaw: 'SISPAG FORNECEDORES',
      structuralHint: { kind: 'pending' },
    })
  })

  // Real line (exactly one occurrence in the fetched file) — the interest on "Conta Garantida",
  // unified with C6's "Cheque especial" under one operator-requested category so "quanto de
  // juros paguei pelo limite" reads as one number across banks (see c6-statement.parser.ts).
  it('classifies the real "JUROS" line as overdraft interest', () => {
    const rows = withHeader(['03/08/2026', 'JUROS       2059.11180-3', '', '', -396.8])
    const result = parseItauStatementSheet(rows)

    expect(result.rows[0].structuralHint).toEqual({ kind: 'expense', category: 'Juros - Limite Garantido' })
  })

  it('parses several consecutive real rows from the fetched file, preserving order and excluding the balance line', () => {
    const rows = withHeader(
      ['31/08/2026', 'SALDO TOTAL DISPONÍVEL DIA', '', '', null, 5686.12],
      ['31/08/2026', 'BOLETO PAGO PEPSICO DO B', 'PEPSICO DO BRASIL LTDA', '31.565.104/0021-10', -1386.36],
      ['31/08/2026', 'PIX RECEBIDO AGILIZ.31/08', 'AGILIZ.AI LTDA', '60.819.321/0001-44', 1300],
      ['31/08/2026', 'PIX ENVIADO', 'BARBARA OLIVEIRA FERNANDES', '333.899.498-28', -4000],
    )
    const result = parseItauStatementSheet(rows)

    expect(result.rejections).toEqual([])
    expect(result.rows.map(r => r.amountCents)).toEqual([138636, 130000, 400000])
    expect(result.rows.map(r => r.direction)).toEqual(['outflow', 'inflow', 'outflow'])
  })
})
