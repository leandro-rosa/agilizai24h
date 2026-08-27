import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBradescoStatement } from './bradesco.parser'

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'agiliz-treasury-test-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

/** Writes a small xlsx with the given rows via ExcelJS — real bytes, same reader
 * (`readWorkbookRows`) the production worker uses, not a hand-typed string. */
async function writeXlsx(rows: unknown[][]): Promise<string> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet0')
  for (const row of rows) sheet.addRow(row)
  const filePath = join(workDir, 'bradesco.xlsx')
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

const REAL_HEADER = ['Data', 'Lançamento', 'Dcto.', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)']

describe('parseBradescoStatement', () => {
  it('locates the header at a real row number, skipping the boilerplate above it', async () => {
    const filePath = await writeXlsx([
      [],
      [null, 'Bradesco Net Empresa'],
      [],
      [],
      [''],
      [''],
      ['Extrato de: Agência: 450  Conta: 25808-3'],
      [''],
      REAL_HEADER,
      ['27/03/2026', 'SALDO ANTERIOR', '', '', '', '0,00'],
      ['24/04/2026', 'PIX RECEBIDO REM: BARBARA OLIVEIRA FERN 24/04', '1107322', '8.100,00', '', '8.100,00'],
      ['24/04/2026', 'TARIFA BANCARIA CESTA PJ FACIL 1', '10426', '', '-168,50', '7.931,50'],
    ])

    const result = await parseBradescoStatement(filePath)

    expect(result.rejections).toEqual([])
    expect(result.rows).toEqual([
      {
        occurredOn: '2026-04-24',
        amountCents: 810000,
        direction: 'inflow',
        counterpartyRaw: 'PIX RECEBIDO REM: BARBARA OLIVEIRA FERN 24/04',
        sourceRef: 'row11',
      },
      {
        occurredOn: '2026-04-24',
        amountCents: 16850,
        direction: 'outflow',
        counterpartyRaw: 'TARIFA BANCARIA CESTA PJ FACIL 1',
        sourceRef: 'row12',
      },
    ])
  })

  it('skips SALDO ANTERIOR — an opening-balance carry-forward, not a movement', async () => {
    const filePath = await writeXlsx([
      REAL_HEADER,
      ['27/03/2026', 'SALDO ANTERIOR', '', '', '', '0,00'],
      ['24/04/2026', 'PIX RECEBIDO REM: X', '1', '100,00', '', '100,00'],
    ])

    const result = await parseBradescoStatement(filePath)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].counterpartyRaw).toBe('PIX RECEBIDO REM: X')
  })

  // Regression: the real file has a SECOND, differently-shaped table below
  // a "Total" footer row ("Saldos Invest Fácil", its own 3-column header,
  // balance snapshots — not movements). Stopping at "Total" must keep it out.
  it('stops at the Total row, never reading the second stacked table below it', async () => {
    const filePath = await writeXlsx([
      REAL_HEADER,
      ['24/04/2026', 'PIX RECEBIDO REM: X', '1', '100,00', '', '100,00'],
      ['Total', 'Total', 'Total', '100,00', '', '100,00'],
      [''],
      ['Saldos Invest Fácil / Plus'],
      [''],
      ['Data', 'Histórico', 'Valor (R$)'],
      ['24/04/2026', 'SALDO INVEST FÁCIL', '7.930,50'],
    ])

    const result = await parseBradescoStatement(filePath)

    expect(result.rows).toHaveLength(1)
    expect(result.rejections).toEqual([])
  })

  it('reports missing columns instead of guessing a layout', async () => {
    const filePath = await writeXlsx([['Coluna A', 'Coluna B'], ['foo', 'bar']])

    const result = await parseBradescoStatement(filePath)

    expect(result.rows).toEqual([])
    expect(result.rejections).toEqual([expect.objectContaining({ rowReference: 'header', reason: 'missing_columns' })])
  })

  it('rejects one bad row without discarding the rest of the file', async () => {
    const filePath = await writeXlsx([
      REAL_HEADER,
      ['32/13/2026', 'LINHA RUIM', '1', '10,00', '', '10,00'],
      ['01/05/2026', 'LINHA BOA', '2', '20,00', '', '30,00'],
    ])

    const result = await parseBradescoStatement(filePath)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].counterpartyRaw).toBe('LINHA BOA')
    expect(result.rejections).toEqual([expect.objectContaining({ rowReference: 'row2', reason: 'unparseable_date' })])
  })
})
